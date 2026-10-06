import path from "node:path"
import { Schema } from "effect"
import type { SupervisorProtocol } from "./protocol"

export namespace SupervisorClient {
  const Registration = Schema.Struct({ url: Schema.String, operatorToken: Schema.String, pluginToken: Schema.String })

  async function registration(home: string) {
    if (!path.isAbsolute(home)) throw new Error("Supervisor home must be an explicit absolute path")
    const registration = Schema.decodeUnknownSync(Registration)(
      await Bun.file(path.join(home, "supervisor.json")).json(),
    )
    const url = new URL(registration.url)
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("Invalid local supervisor registration")
    return { ...registration, url }
  }

  export async function health(home: string) {
    const registered = await registration(home)
    const response = await fetch(new URL("health", registered.url), {
      headers: { authorization: `Bearer ${registered.operatorToken}` },
      signal: AbortSignal.timeout(2000),
    })
    if (!response.ok) throw new Error("Supervisor health unavailable")
    return Schema.decodeUnknownSync(
      Schema.Struct({ pid: Schema.Int, error: Schema.optional(Schema.String), epoch: Schema.optional(Schema.Int) }),
    )(await response.json())
  }

  export async function request(
    home: string,
    operation: SupervisorProtocol.Operation,
    actor: SupervisorProtocol.Actor = { operator: true },
  ) {
    const registered = await registration(home)
    const response = await fetch(new URL("request", registered.url), {
      method: "POST",
      headers: {
        authorization: `Bearer ${"operator" in actor ? registered.operatorToken : registered.pluginToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ operation, sessionID: "sessionID" in actor ? actor.sessionID : undefined }),
      signal: AbortSignal.timeout(60_000),
    })
    const body = Schema.decodeUnknownSync(
      Schema.Struct({ result: Schema.optional(Schema.Unknown), error: Schema.optional(Schema.String) }),
    )(await response.json())
    if (!response.ok) throw new Error(body.error ?? "Supervisor request failed")
    return body.result
  }
}
