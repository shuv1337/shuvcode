import { describe, expect, test } from "bun:test"
import { DatabaseSync } from "node:sqlite"
import { SupervisorAway } from "../src/supervisor/away"

const operator = { operator: true } as const
const lead = { sessionID: "lead" }
function fixture() {
  const db = new DatabaseSync(":memory:")
  const evidence: SupervisorAway.ReturnEvidence = {
    health: ["Healthy"],
    blockers: [],
    waiting: ["User approval"],
    failed: [],
    handled: [],
    cost: ["No price estimate"],
  }
  const options = {
    isLead: (id: string) => id === "lead",
    isInternal: (id: string) => id === "notice",
    snapshot: () => evidence,
  }
  const away = SupervisorAway.open(db, options)
  function enter() {
    away.request(lead, {
      type: "away.propose",
      id: "first",
      words: "I'll be back tomorrow. Do not merge.",
      clauses: [],
      expectedReturn: "yesterday",
    })
    return away.request(operator, { type: "away.confirm", proposalID: "first" })
  }
  return { db, evidence, options, away, enter }
}

describe("durable away contracts", () => {
  test("preserves exact words, refuses incomplete clauses, and requires operator readback confirmation", () => {
    const f = fixture()
    const result = f.away.request(lead, {
      type: "away.propose",
      id: "first",
      words: "  away\nmerge only if green  ",
      clauses: [
        { action: "merge", object: "PR 42", when: "CI green", stop: "on failure" },
        { action: "delete", object: "all", when: "now" },
        { action: "merge", object: "PR 43" },
      ],
    }) as SupervisorAway.Contract
    expect(result.words).toBe("  away\nmerge only if green  ")
    expect(result.clauses).toHaveLength(1)
    expect(result.refused).toEqual([
      { ordinal: 2, reason: "Unknown action: delete" },
      { ordinal: 3, reason: "Missing when" },
    ])
    expect(result.readback).toContain("recorded only")
    expect(f.away.get().enabled).toBe(false)
    expect(() => f.away.request(lead, { type: "away.confirm", proposalID: "first" })).toThrow("local operator")
    f.away.request(operator, { type: "away.confirm", proposalID: "first" })
    expect(f.away.get().enabled).toBe(true)
    f.db.close()
  })

  test("expected return is advisory; internal notices and workers never return the lead", () => {
    const f = fixture()
    f.enter()
    expect(f.away.admit({ sessionID: "lead", messageID: "notice", text: "done" }).deferred).toBe(false)
    expect(f.away.admit({ sessionID: "worker", messageID: "user", text: "hello" }).deferred).toBe(false)
    expect(f.away.admit({ sessionID: "lead", messageID: "afk", text: "/afk" }).deferred).toBe(false)
    expect(f.away.get().enabled).toBe(true)
    f.db.close()
  })

  test("return persists deferred input, survives reopen, and waits only for lead-actionable blockers", () => {
    const f = fixture()
    f.enter()
    f.evidence.blockers.push({ id: "worker", reason: "Needs triage" })
    const response = f.away.admit({ sessionID: "lead", messageID: "user", text: "ship the new feature" })
    expect(response.deferred).toBe(true)
    expect(response.text).not.toContain("ship the new feature")
    expect(response.text).toContain("Needs triage")
    expect(f.away.get().enabled).toBe(false)
    expect(f.away.get().pendingCatchup).toBe(true)
    expect(f.away.pendingInputs()).toEqual([])
    expect(() => f.away.guard()).toThrow("catch-up")
    const reopened = SupervisorAway.open(f.db, f.options)
    expect(reopened.admit({ sessionID: "lead", messageID: "user", text: "changed retry" })).toEqual(response)
    reopened.request(lead, { type: "away.return.check" })
    expect(reopened.get().pendingCatchup).toBe(true)
    f.evidence.blockers.length = 0
    reopened.request(lead, { type: "away.return.check" })
    expect(reopened.get().pendingCatchup).toBe(false)
    expect(reopened.pendingInputs()).toHaveLength(1)
    expect(reopened.pendingInputs()[0]!.text).toBe("ship the new feature")
    expect(reopened.get().catchup!.evidence.waiting).toEqual(["User approval"])
    reopened.ackInput(reopened.pendingInputs()[0]!.id)
    expect(SupervisorAway.open(f.db, f.options).pendingInputs()).toEqual([])
    f.db.close()
  })

  test("replacement preserves entered time, archives prior contracts, and rejects stale confirmation", () => {
    const f = fixture()
    f.enter()
    const first = f.away.get().contract!
    f.away.request(lead, { type: "away.propose", id: "second", words: "new contract", clauses: [] })
    f.away.request(lead, { type: "away.propose", id: "third", words: "latest contract", clauses: [] })
    expect(() => f.away.request(operator, { type: "away.confirm", proposalID: "second" })).toThrow("superseded")
    f.away.request(operator, { type: "away.confirm", proposalID: "third" })
    expect(f.away.get().contract!.enteredAt).toBe(first.enteredAt)
    expect(f.away.get().contract!.revision).toBe(2)
    expect(f.db.prepare("SELECT reason FROM supervisor_away_archive").all()).toEqual([{ reason: "superseded" }])
    f.db.close()
  })

  test("proposal retries bind every clause and an empty re-entry refreshes the existing contract", () => {
    const f = fixture()
    const input = {
      type: "away.propose",
      id: "first",
      words: "exact instruction",
      clauses: [{ action: "merge", object: "PR 42", when: "CI passes" }],
    } as const
    f.away.request(lead, input)
    expect(() => f.away.request(lead, { ...input, clauses: [] })).toThrow("already been used")
    f.away.request(operator, { type: "away.confirm", proposalID: "first" })
    f.away.request(lead, { type: "away.propose", id: "refresh", words: "", clauses: [] })
    f.away.request(operator, { type: "away.confirm", proposalID: "refresh" })
    expect(f.away.get().contract!.words).toBe("exact instruction")
    expect(f.away.get().contract!.clauses).toHaveLength(1)
    expect(() => f.away.request(lead, input)).toThrow("already been confirmed")
    f.db.close()
  })

  test("reclassification retains underlying failures and expires when blocker reason changes", () => {
    const f = fixture()
    f.enter()
    f.evidence.blockers.push({ id: "worker", reason: "Provider outage" })
    f.away.request(lead, { type: "away.return.begin" })
    f.away.request(lead, {
      type: "away.blocker.reclassify",
      blockerID: "worker",
      expectedReason: "Provider outage",
      kind: "external-wait",
      reason: "Waiting for upstream recovery",
      reference: "incident:123",
    })
    expect(f.evidence.blockers).toEqual([{ id: "worker", reason: "Provider outage" }])
    f.evidence.blockers[0]!.reason = "Lost local worktree"
    const reopened = SupervisorAway.open(f.db, f.options)
    reopened.request(lead, { type: "away.return.check" })
    expect(reopened.get().pendingCatchup).toBe(true)
    expect(reopened.get().catchup!.evidence.blockers[0]!.reason).toBe("Lost local worktree")
    expect(() =>
      reopened.request(lead, {
        type: "away.blocker.reclassify",
        blockerID: "worker",
        expectedReason: "Provider outage",
        kind: "external-wait",
        reason: "Waiting",
        reference: "incident:123",
      }),
    ).toThrow("changed")
    reopened.request(lead, {
      type: "away.blocker.reclassify",
      blockerID: "worker",
      expectedReason: "Lost local worktree",
      kind: "external-wait",
      reason: "Operator restoring disk",
      reference: "repair:321",
    })
    reopened.request(lead, { type: "away.return.check" })
    expect(reopened.get().pendingCatchup).toBe(false)
    expect(reopened.get().catchup!.evidence.waiting.join(" ")).toContain("repair:321")
    f.db.close()
  })

  test("user-decision classification requires a currently valid decision reference", () => {
    const f = fixture()
    f.enter()
    f.evidence.blockers.push({ id: "worker", reason: "Needs user" })
    f.away.request(lead, { type: "away.return.begin" })
    const operation = {
      type: "away.blocker.reclassify",
      blockerID: "worker",
      expectedReason: "Needs user",
      kind: "user-decision",
      reason: "Await approval",
      reference: "decision:1",
    } as const
    expect(() => f.away.request(lead, operation)).toThrow("current waiting user decision")
    const valid = SupervisorAway.open(f.db, { ...f.options, validateClassification: () => true })
    valid.request(lead, operation)
    const invalid = SupervisorAway.open(f.db, { ...f.options, validateClassification: () => false })
    invalid.request(lead, { type: "away.return.check" })
    expect(invalid.get().pendingCatchup).toBe(true)
    valid.request(lead, { type: "away.return.check" })
    expect(valid.get().pendingCatchup).toBe(false)
    f.db.close()
  })

  test("away journal preserves resolved failures and handled outcomes across contract replacement", () => {
    const f = fixture()
    f.enter()
    f.away.recordEvidence({
      ...f.evidence,
      health: ["Poll gap"],
      failed: ["Transient error"],
      handled: ["Shipped task"],
    })
    f.away.request(lead, { type: "away.propose", id: "replacement", words: "updated", clauses: [] })
    f.away.request(operator, { type: "away.confirm", proposalID: "replacement" })
    const reopened = SupervisorAway.open(f.db, f.options)
    reopened.request(lead, { type: "away.return.begin" })
    expect(reopened.get().catchup!.brief).toContain("Transient error")
    expect(reopened.get().catchup!.brief).toContain("Shipped task")
    expect(reopened.get().catchup!.brief).toContain("Superseded contract")
    expect(reopened.get().catchup!.evidence.blockers).toEqual([])
    expect(reopened.get().contract?.readback ?? reopened.get().catchup!.contract.readback).not.toContain("default 4")
    f.db.close()
  })

  test("imports legacy enabled posture once without inventing a confirmed contract", () => {
    const db = new DatabaseSync(":memory:")
    db.exec(
      "CREATE TABLE supervisor_channel_away (id INTEGER PRIMARY KEY, enabled INTEGER, until_at INTEGER, note TEXT, updated_at INTEGER); INSERT INTO supervisor_channel_away VALUES (1, 1, 1000, 'legacy note', 500)",
    )
    const options = {
      isLead: () => true,
      isInternal: () => false,
      snapshot: () => ({ health: [], blockers: [], waiting: [], failed: [], handled: [], cost: [] }),
    }
    const away = SupervisorAway.open(db, options)
    expect(away.get().enabled).toBe(true)
    expect(away.get().contract!.words).toBe("legacy note")
    expect(away.get().contract!.readback).toContain("no structured contract or prior readback confirmation")
    away.request(lead, { type: "away.return.begin" })
    away.request(lead, { type: "away.return.check" })
    expect(SupervisorAway.open(db, options).get().enabled).toBe(false)
    db.close()
  })

  test("snapshot callbacks receive the original away window across return and reclassification", () => {
    const f = fixture()
    f.enter()
    const enteredAt = f.away.get().contract!.enteredAt
    const starts: (number | undefined)[] = []
    f.evidence.blockers.push({ id: "worker", reason: "External failure" })
    const away = SupervisorAway.open(f.db, {
      ...f.options,
      snapshot(startedAt) {
        starts.push(startedAt)
        return f.evidence
      },
    })
    away.request(lead, { type: "away.return.begin" })
    away.request(lead, {
      type: "away.blocker.reclassify",
      blockerID: "worker",
      expectedReason: "External failure",
      kind: "external-wait",
      reason: "Recovery pending",
      reference: "incident:12",
    })
    away.request(lead, { type: "away.return.check" })
    expect(starts).toEqual([enteredAt, enteredAt, enteredAt])
    f.db.close()
  })

  test("reopening an active absence retains a coverage gap ahead of later healthy observations", () => {
    const f = fixture()
    f.away.reopened()
    expect(f.db.prepare("SELECT COUNT(*) AS count FROM supervisor_away_observation").get()).toEqual({ count: 0 })
    f.enter()
    const reopened = SupervisorAway.open(f.db, f.options)
    reopened.reopened()
    reopened.recordEvidence(f.evidence)
    reopened.request(lead, { type: "away.return.begin" })
    const initial = reopened.get().catchup!.brief
    expect(initial).toContain("GAP: supervisor restarted")
    expect(initial).toContain("Downtime duration was not measured")
    expect(initial.indexOf("GAP:")).toBeLessThan(initial.indexOf("Healthy"))
    reopened.request(lead, { type: "away.return.check" })
    expect(reopened.get().catchup!.brief).toContain("GAP: supervisor restarted")
    const count = f.db.prepare("SELECT COUNT(*) AS count FROM supervisor_away_observation").get()
    SupervisorAway.open(f.db, f.options).reopened()
    expect(f.db.prepare("SELECT COUNT(*) AS count FROM supervisor_away_observation").get()).toEqual(count)
    f.db.close()
  })

  test("reopening pending catch-up immediately updates its durable brief", () => {
    const f = fixture()
    f.enter()
    f.away.request(lead, { type: "away.return.begin" })
    expect(f.away.get().catchup!.brief).not.toContain("GAP:")
    SupervisorAway.open(f.db, f.options).reopened()
    const reopened = SupervisorAway.open(f.db, f.options)
    expect(reopened.get().pendingCatchup).toBe(true)
    expect(reopened.get().catchup!.brief).toContain("GAP: supervisor restarted")
    reopened.recordEvidence(f.evidence)
    reopened.request(lead, { type: "away.return.check" })
    expect(reopened.get().pendingCatchup).toBe(false)
    expect(reopened.get().catchup!.brief).toContain("GAP: supervisor restarted")
    f.db.close()
  })

  test("snapshot failure cannot discard away posture or user input", () => {
    const f = fixture()
    f.enter()
    const failing = SupervisorAway.open(f.db, {
      ...f.options,
      snapshot() {
        throw new Error("unavailable")
      },
    })
    expect(() => failing.admit({ sessionID: "lead", messageID: "user", text: "new work" })).toThrow("unavailable")
    expect(failing.get().enabled).toBe(true)
    expect(f.db.prepare("SELECT COUNT(*) AS count FROM supervisor_away_archive").get()).toEqual({ count: 0 })
    f.db.close()
  })
})
