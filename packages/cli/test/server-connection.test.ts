import { NodeFileSystem } from "@effect/platform-node"
import { Global } from "@opencode/util/global"
import { OPENCODE_VERSION } from "../src/version"
import { expect, spyOn, test } from "bun:test"
import { Effect, FileSystem, Scope } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ServerConnection } from "../src/services/server-connection"
import { ServiceConfig } from "../src/services/service-config"

test("resolution groups Effect-native lifecycle operations only for the managed service", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-server-resolution-"))
  const id = "server-resolution-test"
  const server = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({
        version: OPENCODE_VERSION,
        pid: process.pid,
        urls: [],
      })
    },
  })
  const registration = path.join(root, "state", ServiceConfig.filename())
  const layer = Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })
  const runPromise = <A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem | Scope.Scope>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer), Effect.scoped))

  try {
    await fs.mkdir(path.dirname(registration), { recursive: true })
    await fs.writeFile(
      registration,
      JSON.stringify({
        id,
        version: OPENCODE_VERSION,
        url: server.url.toString(),
        pid: process.pid,
      }),
    )
    const resolved = await runPromise(ServerConnection.resolve())

    expect(resolved.endpoint.url).toBe(server.url.toString())
    expect(resolved.service).toBeDefined()
    if (!resolved.service) throw new Error("Expected managed service capabilities")
    expect(Effect.isEffect(resolved.service.reconnect())).toBe(true)
    expect(Effect.isEffect(resolved.service.restart())).toBe(true)
    expect(await runPromise(resolved.service.reconnect())).toEqual(resolved.endpoint)

    const explicit = await runPromise(ServerConnection.resolve({ server: server.url.toString() }))
    expect(explicit.endpoint.url).toBe(server.url.toString())
    expect(explicit.service).toBeUndefined()
  } finally {
    await server.stop(true)
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("service options only require a matching version when requested", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-options-"))
  const layer = Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })
  const runPromise = <A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem | Scope.Scope>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer), Effect.scoped))

  try {
    expect((await runPromise(ServiceConfig.options())).version).toBeUndefined()
    expect((await runPromise(ServiceConfig.options({ checkVersion: true }))).version).toBe(OPENCODE_VERSION)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("explicit server falls back to legacy health on /api/info 404 and continues", async () => {
  const requests: string[] = []
  using server = Bun.serve({
    port: 0,
    fetch(request) {
      const pathname = new URL(request.url).pathname
      requests.push(pathname)
      if (pathname === "/api/health") return Response.json({ version: "0.0.0-legacy" })
      return new Response("missing", { status: 404 })
    },
  })
  const stderr = await captureStderr(async () => {
    const resolved = await runExplicit(ServerConnection.resolve({ server: server.url.toString() }))
    expect(resolved.endpoint.url).toBe(server.url.toString())
    expect(resolved.service).toBeUndefined()
  })
  expect(requests).toEqual(["/api/info", "/api/health"])
  expect(stderr).toContain("0.0.0-legacy")
  expect(stderr).toContain("/api/health")
  expect(stderr).toContain("Continuing anyway")
})

test("explicit server reads /api/status when legacy /api/health is missing", async () => {
  using server = Bun.serve({
    port: 0,
    fetch(request) {
      const pathname = new URL(request.url).pathname
      if (pathname === "/api/status") return Response.json({ version: "0.0.0-status", pid: 1 })
      return new Response("missing", { status: 404 })
    },
  })
  const stderr = await captureStderr(async () => {
    const resolved = await runExplicit(ServerConnection.resolve({ server: server.url.toString() }))
    expect(resolved.endpoint.url).toBe(server.url.toString())
  })
  expect(stderr).toContain("0.0.0-status")
  expect(stderr).toContain("/api/status")
  expect(stderr).toContain("Continuing anyway")
})

test("explicit server continues when /api/info and legacy health both 404", async () => {
  using server = Bun.serve({
    port: 0,
    fetch: () => new Response("missing", { status: 404 }),
  })
  const stderr = await captureStderr(async () => {
    const resolved = await runExplicit(ServerConnection.resolve({ server: server.url.toString() }))
    expect(resolved.endpoint.url).toBe(server.url.toString())
  })
  expect(stderr).toContain("HTTP 404")
  expect(stderr).toContain("Restart or upgrade")
  expect(stderr).toContain("Continuing anyway")
})

test("explicit server warns on version skew without probing legacy health", async () => {
  const requests: string[] = []
  using server = Bun.serve({
    port: 0,
    fetch(request) {
      requests.push(new URL(request.url).pathname)
      return Response.json({ version: "other", pid: 1, urls: [], paths: { tmp: "/tmp" } })
    },
  })
  const stderr = await captureStderr(async () => {
    const resolved = await runExplicit(ServerConnection.resolve({ server: server.url.toString() }))
    expect(resolved.service).toBeUndefined()
  })
  expect(requests).toEqual(["/api/info"])
  expect(stderr).toContain("version other")
  expect(stderr).toContain("Continuing anyway")
})

test("explicit server continues when legacy health omits a version", async () => {
  using server = Bun.serve({
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/api/health") return Response.json({ healthy: true })
      return new Response("missing", { status: 404 })
    },
  })
  const stderr = await captureStderr(async () => {
    await runExplicit(ServerConnection.resolve({ server: server.url.toString() }))
  })
  expect(stderr).toContain("/api/health")
  expect(stderr).toContain("without a version")
  expect(stderr).toContain("Continuing anyway")
})

test("explicit server still fails when /api/info is unauthorized", async () => {
  using server = Bun.serve({
    port: 0,
    fetch: () => Response.json({ _tag: "UnauthorizedError", message: "Unauthorized" }, { status: 401 }),
  })
  await expect(runExplicit(ServerConnection.resolve({ server: server.url.toString() }))).rejects.toThrow(
    "requires a password",
  )
})

test("explicit server still fails when /api/info returns 503", async () => {
  using server = Bun.serve({ port: 0, fetch: () => new Response("Unavailable", { status: 503 }) })
  await expect(runExplicit(ServerConnection.resolve({ server: server.url.toString() }))).rejects.toThrow(
    "did not provide a compatible V2 health response",
  )
})

async function runExplicit<A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem | Scope.Scope>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-explicit-server-"))
  const layer = Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })
  try {
    return await Effect.runPromise(
      effect.pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer), Effect.scoped),
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

async function captureStderr(run: () => Promise<void>) {
  const stderr: string[] = []
  const stderrWrite = spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk))
    return true
  })
  try {
    await run()
    return stderr.join("")
  } finally {
    stderrWrite.mockRestore()
  }
}
