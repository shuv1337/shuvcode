import { SupervisorClient } from "./client"
import { chmod, rename, rm } from "node:fs/promises"
import path from "node:path"
import { Schema } from "effect"
import { SupervisorNative } from "./native"
import { SupervisorProtocol } from "./protocol"
import { SupervisorRuntime } from "./runtime"

export namespace SupervisorAPI {
  export async function serve(input: {
    home: string
    endpoint: string
    password?: string
    port?: number
    intervalMs?: number
    managed?: { epoch: number; pilotID: string; fencedEpoch?: number }
  }) {
    if (typeof Bun === "undefined" || typeof Bun.serve !== "function")
      throw new Error("The experimental supervisor requires Bun")
    if (!path.isAbsolute(input.home)) throw new Error("Supervisor home must be an explicit absolute path")
    const endpoint = new URL(input.endpoint)
    if (!["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname))
      throw new Error("This pilot requires a local native server; remote worktree operation is not implemented")
    const native = SupervisorNative.connect({ url: input.endpoint, password: input.password })
    await native.info()
    const runtime = await SupervisorRuntime.open({
      home: input.home,
      endpoint: input.endpoint,
      native,
      managed: input.managed,
    })
    if (input.managed?.fencedEpoch !== undefined) {
      await runtime
        .recoverFencedEpoch({
          from: input.managed.fencedEpoch,
          to: input.managed.epoch,
          pilotID: input.managed.pilotID,
        })
        .catch(async (error) => {
          await runtime.close()
          throw error
        })
    }
    const health: { error?: string } = {}
    const tokens = { operatorToken: crypto.randomUUID(), pluginToken: crypto.randomUUID() }
    const server = await Promise.resolve()
      .then(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: input.port ?? 0,
          maxRequestBodySize: 1024 * 1024,
          idleTimeout: 0,
          async fetch(request) {
            if (request.headers.has("origin"))
              return Response.json({ error: "Browser requests are unsupported" }, { status: 403 })
            const auth = request.headers.get("authorization")
            const operator = auth === `Bearer ${tokens.operatorToken}`
            if (!operator && auth !== `Bearer ${tokens.pluginToken}`)
              return Response.json({ error: "Unauthorized" }, { status: 401 })
            if (request.method === "GET" && new URL(request.url).pathname === "/health" && operator)
              return Response.json({ pid: process.pid, error: health.error, epoch: input.managed?.epoch })
            if (request.method !== "POST" || new URL(request.url).pathname !== "/request")
              return Response.json({ error: "Not found" }, { status: 404 })
            try {
              const body = Schema.decodeUnknownSync(SupervisorProtocol.Request)(await request.json())
              if (!operator && !body.sessionID)
                return Response.json({ error: "Native session context required" }, { status: 403 })
              const result = await runtime.request(
                operator ? { operator: true } : { sessionID: body.sessionID! },
                body.operation,
              )
              return Response.json({ result: result ?? null })
            } catch (error) {
              return Response.json(
                { error: error instanceof Error ? error.message : "Supervisor request failed" },
                { status: 400 },
              )
            }
          },
        }),
      )
      .catch(async (error) => {
        await runtime.close()
        throw error
      })
    const registration = path.join(runtime.home, "supervisor.json")
    const temporary = `${registration}.${process.pid}.tmp`
    try {
      await Bun.write(temporary, JSON.stringify({ url: server.url.toString(), ...tokens }), { mode: 0o600 })
      await chmod(temporary, 0o600)
      await rename(temporary, registration)
    } catch (error) {
      await server.stop(true)
      await runtime.close()
      await rm(temporary, { force: true })
      throw error
    }
    let pending = false
    const timer = setInterval(() => {
      if (pending) return
      pending = true
      void runtime
        .reconcile()
        .then(() => {
          health.error = undefined
        })
        .catch((error) => {
          health.error = error instanceof Error ? error.message : "Supervisor reconciliation failed"
        })
        .finally(() => {
          pending = false
        })
    }, input.intervalMs ?? 1000)
    return {
      url: server.url.toString(),
      interruptedSessionIDs: runtime.recoveryInterruptions(),
      async close() {
        clearInterval(timer)
        await server.stop(true)
        await rm(registration, { force: true })
        await runtime.close()
      },
    }
  }

  export const request = SupervisorClient.request
}
