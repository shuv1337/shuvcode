import { Service } from "@opencode-ai/client/effect"
import { ClientError, isUnauthorizedError, OpenCode } from "@opencode-ai/client/promise"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Effect } from "effect"

type ConnectOptions = {
  readonly url: string
  readonly username?: string
  readonly password?: string
}

export const connect = Effect.fn("cli.daemon.connect")(function* (options: ConnectOptions) {
  const endpoint = {
    url: options.url,
    auth:
      options.password === undefined
        ? undefined
        : { type: "basic" as const, username: options.username ?? "opencode", password: options.password },
  } satisfies Service.Endpoint
  const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
  const health = yield* Effect.tryPromise({
    try: () => client.health.get({ signal: AbortSignal.timeout(5_000) }),
    catch: (cause) => connectError(options, cause),
  })
  if (health.version !== InstallationVersion)
    process.stderr.write(
      `Warning: Server at ${options.url} has version ${health.version}; this client is ${InstallationVersion}. Continuing anyway.\n`,
    )
  return endpoint
})

function connectError(options: ConnectOptions, cause: unknown) {
  if (isUnauthorizedError(cause)) {
    return new Error(
      options.password === undefined
        ? `Server at ${options.url} requires authentication; provide a password`
        : `Server at ${options.url} rejected the supplied credentials`,
      { cause },
    )
  }
  if (cause instanceof ClientError && cause.reason === "Transport")
    return new Error(`Could not reach server at ${options.url}`, { cause })
  return new Error(`Server at ${options.url} did not provide a compatible V2 health response`, { cause })
}

export * as Daemon from "./daemon"
