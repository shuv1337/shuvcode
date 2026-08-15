export * as AnthropicClaudeCodeProxy from "./anthropic-claude-code-proxy"

// Loopback OAuth authorizer for Claude Pro/Max subscription requests.
//
// The native AnthropicMessages route resolves its credential once per model
// resolution, so a long-running session can hold a token that expires
// mid-drain, and every request authenticates with whatever the resolver saw.
// Pointing the provider baseURL at this proxy moves authorization to request
// time: each request resolves the current access token (refreshed by
// Integration.connection.resolve when stale) and presents with Claude Code's
// headers before forwarding to Anthropic.
//
// Deliberately auth-only: body shaping and response tool-name mapping stay in
// the claude-code transport (anthropic-claude-code.ts), which owns the wire
// shape and its billing canary. This proxy only replaces the credential and
// header presentation, so the two seams cannot drift apart.

import type { IncomingMessage, Server, ServerResponse } from "node:http"
import { AnthropicClaudeCode } from "./anthropic-claude-code"

const ANTHROPIC_ORIGIN = "https://api.anthropic.com"

// Hop-by-hop headers and fetch-forbidden request headers that must not be
// forwarded verbatim to the upstream Anthropic request.
const STRIP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  "proxy-connection",
  "upgrade",
  "expect",
  "te",
])

// Response headers that describe the local hop and must be recomputed by the
// Node server rather than copied from the upstream response.
const STRIP_RESPONSE_HEADERS = new Set(["content-length", "content-encoding", "transfer-encoding", "connection"])

export interface Proxy {
  /** Origin to derive the provider `settings.baseURL` from, e.g. `http://127.0.0.1:54123`. */
  readonly url: string
  close(): Promise<void>
}

export async function start(input: {
  getAccessToken: () => Promise<string | undefined>
  /** Upstream transport override; defaults to a captured global fetch so the upstream call cannot re-enter a patch. */
  fetchImpl?: (input: Request | string | URL, init?: RequestInit) => Promise<Response>
}): Promise<Proxy> {
  const { createServer } = await import("node:http")
  const fetchImpl = input.fetchImpl ?? globalThis.fetch.bind(globalThis)

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const access = await input.getAccessToken()
    if (!access) {
      res.writeHead(401, { "content-type": "application/json" })
      res.end(errorPayload("authentication_error", "No Claude subscription credential is available"))
      return
    }

    const incoming: Record<string, string> = {}
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined) continue
      const key = name.toLowerCase()
      if (STRIP_REQUEST_HEADERS.has(key) || key === "x-api-key" || key === "authorization") continue
      incoming[key] = Array.isArray(value) ? value.join(", ") : value
    }
    const headers = new Headers({ ...incoming, ...AnthropicClaudeCode.headers(incoming) })
    headers.set("authorization", `Bearer ${access}`)

    const method = (req.method ?? "POST").toUpperCase()
    const raw = method === "GET" || method === "HEAD" ? undefined : await readBody(req)
    const upstream = await fetchImpl(ANTHROPIC_ORIGIN + (req.url ?? "/"), {
      method,
      headers,
      body: raw && raw.byteLength > 0 ? Buffer.from(raw) : undefined,
    })

    const outHeaders: Record<string, string> = {}
    upstream.headers.forEach((value, key) => {
      if (STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) return
      outHeaders[key] = value
    })
    res.writeHead(upstream.status, outHeaders)

    if (!upstream.body) {
      res.end()
      return
    }
    const reader = upstream.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) res.write(Buffer.from(value))
    }
    res.end()
  }

  const server: Server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" })
      res.end(errorPayload("proxy_error", `Claude subscription proxy failed: ${message}`))
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject)
      resolve()
    })
  })

  const address = server.address()
  const port = typeof address === "object" && address !== null ? address.port : 0
  if (!port) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    throw new Error("Claude subscription proxy failed to bind a loopback port")
  }

  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}

const readBody = (req: IncomingMessage): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => resolve(Buffer.concat(chunks)))
    req.on("error", reject)
  })

const errorPayload = (type: string, message: string) => JSON.stringify({ type: "error", error: { type, message } })
