import { Context, Layer } from "effect"
import { networkInterfaces } from "node:os"
import type { ServerOptions } from "./options"

export class Service extends Context.Service<
  Service,
  { readonly urls: () => ReadonlyArray<string>; readonly app: NonNullable<ServerOptions["app"]> }
>()("@opencode-ai/server/ServerInfo") {}

export function layer(urls: () => ReadonlyArray<string>, app: ServerOptions["app"] = {}) {
  return Layer.succeed(Service, Service.of({ urls, app }))
}

export function connectionURLs(value: string, requestedHostname?: string) {
  const url = new URL(value)
  const hostname = requestedHostname ?? url.hostname
  const family = hostname === "0.0.0.0" ? "IPv4" : hostname === "::" || hostname === "[::]" ? "IPv6" : undefined
  if (family === undefined) return [value]

  return [
    ...new Set(
      Object.values(networkInterfaces())
        .flatMap((entries) => entries ?? [])
        .filter((entry) => !entry.internal && entry.family === family)
        .map((entry) => {
          const result = new URL(value)
          result.hostname = family === "IPv6" ? `[${entry.address}]` : entry.address
          return result.toString().replace(/\/$/, "")
        }),
    ),
  ]
}

export function advertisedURLs(values: ReadonlyArray<string>) {
  return [...new Set(values.map(advertisedURL))]
}

function advertisedURL(value: string) {
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Advertised URLs must use HTTP or HTTPS")
  const rawPath = value.trim().match(/^[a-z][a-z\d+.-]*:\/\/[^/\\?#]*([/\\][^?#]*)?/i)?.[1]
  if (rawPath !== undefined && rawPath !== "/")
    throw new Error("Advertised URLs cannot contain userinfo, a path, query, or fragment")
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("Advertised URLs cannot contain userinfo, a path, query, or fragment")
  if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("Advertised HTTP URLs must be loopback")
  return url.toString().replace(/\/$/, "")
}

export * as ServerInfo from "./server-info"
