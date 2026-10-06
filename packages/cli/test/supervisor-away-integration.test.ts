import { expect, test } from "bun:test"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { SupervisorAPI } from "../src/supervisor/api"
import { SupervisorNative } from "../src/supervisor/native"
import { createSupervisorFixture } from "./fixtures/supervisor"

for (const freshLead of [false, true]) {
  test(`native lead prompt defers through supervisor restart${freshLead ? " and fresh lead" : ""}, then releases once`, async () => {
    await using fixture = await createSupervisorFixture(() => "Catch-up acknowledged")
    const server = await fixture.startServer()
    const native = SupervisorNative.connect({ url: server.url, password: server.password })
    const originalLead = "ses_away_original_lead"
    const resumedLead = freshLead ? "ses_away_fresh_lead" : originalLead
    const originalText = "Only after catch-up, inspect the deferred feature named amber-orchid."
    const serve = () =>
      SupervisorAPI.serve({ home: fixture.home, endpoint: server.url, password: server.password, intervalMs: 50 })
    await native.create({
      sessionID: originalLead,
      directory: fixture.project,
      agent: "build",
      model: { providerID: "test", id: "test-model" },
      permissions: [],
    })
    let api: Awaited<ReturnType<typeof serve>> | undefined = await serve()
    try {
      await native.pluginReady(fixture.project, "native-supervisor-pilot")
      await SupervisorAPI.request(fixture.home, {
        type: "lead.activate",
        sessionID: originalLead,
        expectedGeneration: 0,
      })
      await SupervisorAPI.request(fixture.home, {
        type: "away.propose",
        id: "away-fixture",
        words: "Away until I return",
        clauses: [],
      })
      await SupervisorAPI.request(fixture.home, { type: "away.confirm", proposalID: "away-fixture" })
      await SupervisorAPI.request(fixture.home, {
        type: "inbox.note",
        id: "relay-note",
        source: "relay",
        trusted: false,
        text: "Background relay update",
      })
      await until(
        async () =>
          (await native.messages(originalLead)).data.some(
            (message) => message.type === "user" && message.text.includes("Background relay update"),
          ) || undefined,
      )
      expect((await posture(fixture.home)).enabled).toBe(true)
      expect((await posture(fixture.home)).pendingCatchup).toBe(false)
      await until(async () => !(await native.active()).includes(originalLead) || undefined)

      await api.close()
      api = await serve()
      expect((await posture(fixture.home)).enabled).toBe(true)

      // This is the same native Session.prompt boundary used by a TUI client, with no supervisor send wrapper.
      await native.prompt({
        sessionID: originalLead,
        id: "msg_away_tui_input",
        text: originalText,
        delivery: "steer",
        resume: false,
      })
      const pending = (await native.inbox(originalLead)).find((item) => item.id === "msg_away_tui_input")
      expect(pending?.text).toContain("Return catch-up must complete before new work")
      expect(pending?.text).not.toContain("amber-orchid")
      expect(pending?.text).toContain("GAP: supervisor restarted")
      expect((await posture(fixture.home)).enabled).toBe(false)
      expect((await posture(fixture.home)).pendingCatchup).toBe(true)
      expect((await posture(fixture.home)).catchup?.brief).toContain("GAP: supervisor restarted")
      expect(fixture.llm.requests.some((request) => JSON.stringify(request).includes("amber-orchid"))).toBe(false)
      expect(rows(fixture.home, "SELECT text, acknowledged FROM supervisor_away_input")).toEqual([
        { text: originalText, acknowledged: 0 },
      ])

      await api.close()
      api = undefined
      if (freshLead)
        await native.create({
          sessionID: resumedLead,
          directory: fixture.project,
          agent: "build",
          model: { providerID: "test", id: "test-model" },
          permissions: [],
        })
      api = await serve()
      if (freshLead)
        await SupervisorAPI.request(fixture.home, {
          type: "lead.activate",
          sessionID: resumedLead,
          expectedGeneration: 1,
          adoptPending: true,
        })
      expect((await posture(fixture.home)).pendingCatchup).toBe(true)
      expect(fixture.llm.requests.some((request) => JSON.stringify(request).includes("amber-orchid"))).toBe(false)
      await SupervisorAPI.request(fixture.home, { type: "away.return.check" })
      await until(
        async () =>
          (await native.messages(resumedLead)).data.some(
            (message) => message.type === "user" && message.text.endsWith(originalText),
          ) || undefined,
      )
      await until(
        async () =>
          rows(fixture.home, "SELECT acknowledged FROM supervisor_away_input")[0]?.acknowledged === 1 || undefined,
      )
      expect((await posture(fixture.home)).pendingCatchup).toBe(false)
      expect((await posture(fixture.home)).catchup?.brief).toContain("GAP: supervisor restarted")
      await SupervisorAPI.request(fixture.home, { type: "away.return.check" })
      await until(async () => !(await native.active()).includes(resumedLead) || undefined)
      await api.close()
      api = await serve()
      await SupervisorAPI.request(fixture.home, { type: "away.return.check" })
      await Bun.sleep(250)
      const messages = (await native.messages(resumedLead)).data
      expect(messages.filter((message) => message.type === "user" && message.text.endsWith(originalText))).toHaveLength(
        1,
      )
      expect(fixture.llm.requests.some((request) => JSON.stringify(request).includes("amber-orchid"))).toBe(true)
      expect(rows(fixture.home, "SELECT COUNT(*) AS count FROM notice WHERE key LIKE 'msg_away_%'")).toEqual([
        { count: 1 },
      ])
      if (freshLead)
        expect(
          (await native.messages(originalLead)).data.some(
            (message) => message.type === "user" && message.text.endsWith(originalText),
          ),
        ).toBe(false)
    } finally {
      await api?.close()
    }
  }, 60_000)
}

async function posture(home: string) {
  return (await SupervisorAPI.request(home, { type: "away.get" })) as {
    enabled: boolean
    pendingCatchup: boolean
    catchup?: { brief: string }
  }
}

function rows(home: string, query: string) {
  const db = new DatabaseSync(path.join(home, "supervisor.sqlite"), { readOnly: true })
  try {
    return db.prepare(query).all() as Record<string, unknown>[]
  } finally {
    db.close()
  }
}

async function until<T>(probe: () => Promise<T | undefined>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await probe()
    if (result !== undefined) return result
    await Bun.sleep(50)
  }
  throw new Error("Timed out waiting for native away integration evidence")
}
