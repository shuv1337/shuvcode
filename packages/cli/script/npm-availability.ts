import { Schema } from "effect"

export type NpmPackageStatus =
  | { readonly name: string; readonly version: string; readonly ready: true; readonly tarball: string }
  | { readonly name: string; readonly version: string; readonly ready: false; readonly reason: string }

type PendingPackage = Extract<NpmPackageStatus, { readonly ready: false }>

const defaultRegistry = "https://registry.npmjs.org"

const Dist = Schema.Struct({ tarball: Schema.String })
const decodePackument = Schema.decodeUnknownOption(
  Schema.Struct({
    "dist-tags": Schema.optional(Schema.Record(Schema.String, Schema.String)),
    versions: Schema.Record(Schema.String, Schema.Struct({ dist: Dist })),
  }),
)
const decodeVersion = Schema.decodeUnknownOption(Schema.Struct({ version: Schema.String, dist: Dist }))

/**
 * npm accepts a publish before every registry view agrees on it. Installs read the
 * abbreviated packument, the version document and the tarball through different caches,
 * so a version is usable only once all three serve it.
 */
export async function checkNpmPackageAvailability(
  name: string,
  version: string,
  options: { readonly expectedTag?: string; readonly registry?: string; readonly fetch?: typeof globalThis.fetch } = {},
): Promise<NpmPackageStatus> {
  const request = options.fetch ?? globalThis.fetch
  const registry = options.registry ?? defaultRegistry
  const pending = (reason: string) => ({ name, version, ready: false as const, reason })

  const packumentResponse = await request(`${registry}/${encodeURIComponent(name)}`, {
    headers: { Accept: "application/vnd.npm.install-v1+json", "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(15_000),
  })
  if (packumentResponse.status !== 200) {
    await packumentResponse.body?.cancel()
    return pending(`packument returned HTTP ${packumentResponse.status}`)
  }
  const packument = decodePackument(await packumentResponse.json().catch(() => undefined))
  if (packument._tag === "None") return pending("packument is not valid npm metadata")
  const tarball = packument.value.versions[version]?.dist.tarball
  if (!tarball) return pending("packument does not list the version")
  if (!tarball.startsWith("https://")) return pending(`packument tarball URL is not https: ${tarball}`)
  if (options.expectedTag !== undefined && packument.value["dist-tags"]?.[options.expectedTag] !== version)
    return pending(
      `dist-tag ${options.expectedTag} is ${packument.value["dist-tags"]?.[options.expectedTag] ?? "unset"}`,
    )

  const versionResponse = await request(`${registry}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, {
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(15_000),
  })
  if (versionResponse.status !== 200) {
    await versionResponse.body?.cancel()
    return pending(`version metadata returned HTTP ${versionResponse.status}`)
  }
  const metadata = decodeVersion(await versionResponse.json().catch(() => undefined))
  if (metadata._tag === "None") return pending("version metadata is not valid npm metadata")
  if (metadata.value.version !== version) return pending(`version metadata reports ${metadata.value.version}`)
  if (metadata.value.dist.tarball !== tarball)
    return pending(`version metadata tarball ${metadata.value.dist.tarball} does not match ${tarball}`)

  const tarballResponse = await request(tarball, {
    method: "HEAD",
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(15_000),
  })
  await tarballResponse.body?.cancel()
  if (tarballResponse.status !== 200) return pending(`tarball returned HTTP ${tarballResponse.status}`)
  return { name, version, ready: true, tarball }
}

/** Whether npm already accepted this version, so a retried publish must not upload it again. */
export async function isNpmVersionUploaded(
  name: string,
  version: string,
  options: { readonly registry?: string; readonly fetch?: typeof globalThis.fetch } = {},
) {
  const response = await (options.fetch ?? globalThis.fetch)(
    `${options.registry ?? defaultRegistry}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(15_000),
    },
  )
  await response.body?.cancel()
  if (response.status === 200) return true
  if (response.status === 404) return false
  throw new Error(`npm registry returned HTTP ${response.status} for ${name}@${version}`)
}

export async function waitForNpmPackages(
  names: readonly string[],
  version: string,
  options: {
    readonly expectedTag?: string
    readonly registry?: string
    readonly fetch?: typeof globalThis.fetch
    readonly sleep?: (ms: number) => Promise<void>
    readonly now?: () => number
    readonly timeoutMs?: number
    readonly intervalMs?: number
    readonly onPending?: (pending: readonly PendingPackage[]) => void
  } = {},
): Promise<void> {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? Bun.sleep
  const timeoutMs = options.timeoutMs ?? 45 * 60_000
  const intervalMs = options.intervalMs ?? 15_000
  const onPending =
    options.onPending ??
    ((pending: readonly PendingPackage[]) =>
      console.log(
        `waiting for npm availability: ${pending.map((item) => `${item.name}@${item.version} (${item.reason})`).join(", ")}`,
      ))
  const startedAt = now()

  const attempt = async (): Promise<void> => {
    const statuses = await Promise.all(
      names.map((name) =>
        checkNpmPackageAvailability(name, version, {
          expectedTag: options.expectedTag,
          registry: options.registry,
          fetch: options.fetch,
        }).catch((cause: unknown) => ({
          name,
          version,
          ready: false as const,
          reason: cause instanceof Error ? cause.message : String(cause),
        })),
      ),
    )
    const pending = statuses.filter((status): status is PendingPackage => !status.ready)
    if (pending.length === 0) return
    if (now() - startedAt >= timeoutMs)
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for npm availability: ${pending.map((item) => `${item.name}@${item.version} (${item.reason})`).join(", ")}`,
      )
    onPending(pending)
    await sleep(intervalMs)
    return attempt()
  }
  return attempt()
}
