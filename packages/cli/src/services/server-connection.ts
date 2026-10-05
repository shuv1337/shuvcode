import { Service, type Endpoint, type EnsureOptions } from "@opencode/client/effect/service"
import { ClientError, isUnauthorizedError, OpenCode } from "@opencode/client/promise"
import { OPENCODE_VERSION } from "../version"
import { Cause, Effect, Exit, Redacted } from "effect"
import { Env } from "../env"
import { ServiceConfig } from "./service-config"
import { Standalone } from "./standalone"

export type Args = {
  readonly server?: string
  readonly standalone?: boolean
  readonly mismatch?: "replace" | "ignore" | "error"
  readonly onStart?: EnsureOptions["onStart"]
}

export type Resolved = {
  readonly endpoint: Endpoint
  readonly service?: ReturnType<typeof managedService>
}

export const resolve = Effect.fn("cli.server-connection.resolve")(function* (args: Args = {}) {
  if (args.server !== undefined && args.standalone)
    return yield* Effect.fail(new Error("--server and --standalone cannot be combined"))
  if (args.server !== undefined) {
    const password = yield* Env.password
    const endpoint = {
      url: args.server,
      auth: password ? { type: "basic" as const, username: "opencode", password: Redacted.value(password) } : undefined,
    } satisfies Endpoint
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    const probed = yield* Effect.exit(
      Effect.tryPromise({
        try: () => client.server.info({ signal: AbortSignal.timeout(5_000) }),
        catch: (cause) => cause,
      }),
    )
    if (Exit.isSuccess(probed)) {
      if (probed.value.version !== OPENCODE_VERSION)
        process.stderr.write(
          `Warning: Server at ${endpoint.url} has version ${probed.value.version}; this client is ${OPENCODE_VERSION}. Continuing anyway.\n`,
        )
      return { endpoint } satisfies Resolved
    }
    // Explicit --server must not replace a live server. HTTP 404 means this client
    // asked /api/info of a build that still answers on legacy health.
    const cause = Cause.squash(probed.cause)
    if (unexpectedStatus(cause) !== 404) return yield* Effect.fail(connectError(endpoint, cause))
    const legacy = yield* legacyHealth(endpoint)
    process.stderr.write(legacySkewWarning(endpoint.url, legacy))
    return { endpoint } satisfies Resolved
  }
  if (args.standalone || (yield* ServiceConfig.read()).disabled === true) {
    return { endpoint: yield* Standalone.start() } satisfies Resolved
  }

  const mismatch = args.mismatch ?? "ignore"
  const options = yield* ServiceConfig.options({ checkVersion: mismatch !== "ignore" })
  return {
    endpoint: yield* resolveManaged({ ...options, onStart: args.onStart }, mismatch),
    service: managedService(options),
  } satisfies Resolved
})

function managedService(options: EnsureOptions) {
  const reconnectOptions = { ...options, version: undefined }
  return {
    reconnect: () => Service.ensure(reconnectOptions),
    restart: () =>
      Effect.gen(function* () {
        yield* Service.stop({ file: options.file, pty: "handoff" })
        yield* Service.ensure(reconnectOptions)
      }),
  }
}

export const shutdownPersistentPty = Effect.fn("cli.server-connection.shutdown-persistent-pty")(function* (
  options: EnsureOptions,
) {
  const endpoint = yield* Service.discover({ ...options, version: undefined })
  if (!endpoint) return
  const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
  yield* Effect.tryPromise(() => client.experimental.persistentPty.shutdown())
})

const resolveManaged = Effect.fnUntraced(function* (options: EnsureOptions, mismatch: NonNullable<Args["mismatch"]>) {
  if (mismatch === "replace") return yield* Service.ensure(options)
  if (mismatch === "ignore") return yield* Service.ensure({ ...options, version: undefined })

  const compatible = yield* Service.discover(options)
  if (compatible !== undefined) return compatible
  const existing = yield* Service.discover({ ...options, version: undefined })
  if (existing !== undefined)
    return yield* Effect.fail(new Error("Background server version does not match this client"))
  return yield* Service.ensure(options)
})

const legacyPaths = ["/api/health", "/api/status"] as const

const legacyHealth = Effect.fnUntraced(function* (endpoint: Endpoint) {
  const headers = Service.headers(endpoint)
  const signal = AbortSignal.timeout(5_000)
  let answered: (typeof legacyPaths)[number] | undefined
  for (const pathname of legacyPaths) {
    const response = yield* Effect.promise(() =>
      fetch(new URL(pathname, endpoint.url), { headers, signal }).catch(() => undefined),
    )
    if (!response?.ok) continue
    const version = versionOf(yield* Effect.promise(() => response.json().catch(() => undefined)))
    if (version !== undefined) return { pathname, version }
    answered ??= pathname
  }
  if (answered === undefined) return undefined
  return { pathname: answered }
})

function legacySkewWarning(
  url: string,
  legacy: { readonly pathname: (typeof legacyPaths)[number]; readonly version?: string } | undefined,
) {
  if (legacy?.version !== undefined)
    return `Warning: Server at ${url} has version ${legacy.version} via ${legacy.pathname}; this client is ${OPENCODE_VERSION}. Continuing anyway.\n`
  if (legacy !== undefined)
    return `Warning: Server at ${url} answered ${legacy.pathname} without a version, and /api/info returned HTTP 404. This client is ${OPENCODE_VERSION}. Continuing anyway.\n`
  return `Warning: Server at ${url} returned HTTP 404 for /api/info and has no legacy /api/health or /api/status response. This client is ${OPENCODE_VERSION}. Continuing anyway. Restart or upgrade that server if this client cannot connect.\n`
}

function unexpectedStatus(cause: unknown) {
  if (!(cause instanceof ClientError) || cause.reason !== "UnexpectedStatus") return undefined
  const status = cause.cause
  if (typeof status !== "object" || status === null || !("status" in status)) return undefined
  return typeof status.status === "number" ? status.status : undefined
}

function versionOf(body: unknown) {
  if (typeof body !== "object" || body === null || !("version" in body)) return undefined
  if (typeof body.version !== "string" || body.version.length === 0) return undefined
  return body.version
}

function connectError(endpoint: Endpoint, cause: unknown) {
  if (isUnauthorizedError(cause)) {
    return new Error(
      endpoint.auth === undefined
        ? `Server at ${endpoint.url} requires a password; set OPENCODE_PASSWORD`
        : `Server at ${endpoint.url} rejected the password`,
      { cause },
    )
  }
  if (cause instanceof ClientError && cause.reason === "Transport")
    return new Error(`Could not reach server at ${endpoint.url}`, { cause })
  return new Error(`Server at ${endpoint.url} did not provide a compatible V2 health response`, { cause })
}

export * as ServerConnection from "./server-connection"
