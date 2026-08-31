import { describe, expect, test } from "bun:test"
import type { FoldInput, GoalRecord, StepFlags } from "../src/state"
import { DEFAULT_LIMITS, continuationInputID, createGoal, foldEvent } from "../src/state"

const NOW = 1_000_000

function activeGoal(): GoalRecord {
  return createGoal({
    sessionID: "ses_test",
    location: "/tmp/project",
    definition: { objective: "fix tests", successCriteria: ["tests pass"], constraints: [], references: [] },
    limits: DEFAULT_LIMITS,
    now: NOW,
  })
}

const flags = (toolSuccess = false): StepFlags => ({ toolSuccess })

function fold(record: GoalRecord, input: FoldInput, stepFlags: StepFlags = flags()) {
  return foldEvent(record, input, NOW + 1000, stepFlags)
}

describe("continuation reservation", () => {
  test("a successful execution reserves exactly one continuation", () => {
    const record = activeGoal()
    const result = fold(record, { type: "execution.succeeded", seq: 5, eventID: "evt_abc" })
    expect(result.effects).toEqual(["reserve"])
    const reservation = result.record.execution.reservation
    expect(reservation?.status).toBe("reserved")
    expect(reservation?.sourceExecutionEventID).toBe("evt_abc")
    expect(reservation?.sourceExecutionSeq).toBe(5)
    expect(reservation?.inputID).toBe(continuationInputID("evt_abc"))
    expect(result.record.window.continuations).toBe(1)
    expect(result.record.lifetime.continuations).toBe(1)
  })

  test("duplicate observation of the same execution event is a no-op", () => {
    const record = activeGoal()
    const first = fold(record, { type: "execution.succeeded", seq: 5, eventID: "evt_abc" })
    const second = fold(first.record, { type: "execution.succeeded", seq: 5, eventID: "evt_abc" })
    expect(second.effects).toEqual([])
    expect(second.record.window.continuations).toBe(1)
  })

  test("an existing reservation prevents a second one", () => {
    const record = activeGoal()
    const first = fold(record, { type: "execution.succeeded", seq: 5, eventID: "evt_abc" })
    const second = fold(first.record, { type: "execution.succeeded", seq: 6, eventID: "evt_def" })
    expect(second.effects).toEqual([])
    expect(second.record.window.continuations).toBe(1)
  })

  test("deterministic continuation input IDs derive from the source event", () => {
    expect(continuationInputID("evt_123")).toBe("msg_123goal")
  })

  test("continuation limit transitions to limited instead of reserving", () => {
    const record = activeGoal()
    record.window.continuations = 10
    const result = fold(record, { type: "execution.succeeded", seq: 5, eventID: "evt_abc" })
    expect(result.effects).toEqual(["persist"])
    expect(result.record.state).toBe("limited")
    expect(result.record.stop?.code).toBe("limit_continuations")
  })

  test("non-active goals never reserve", () => {
    const record = activeGoal()
    record.state = "paused"
    const result = fold(record, { type: "execution.succeeded", seq: 5, eventID: "evt_abc" })
    expect(result.effects).toEqual([])
  })
})

describe("user-input fencing", () => {
  test("a newer user input invalidates an unadmitted reservation", () => {
    const record = activeGoal()
    const reserved = fold(record, { type: "execution.succeeded", seq: 5, eventID: "evt_abc" })
    const fenced = fold(reserved.record, { type: "input.admitted", seq: 6, inputID: "msg_user1", kind: "user" })
    expect(fenced.record.execution.reservation).toBeUndefined()
    expect(fenced.record.execution.latestUserInput).toEqual({ inputID: "msg_user1", seq: 6 })
  })

  test("the plugin's own synthetic input reconciles instead of fencing", () => {
    const record = activeGoal()
    const reserved = fold(record, { type: "execution.succeeded", seq: 5, eventID: "evt_abc" })
    const inputID = reserved.record.execution.reservation!.inputID
    const admitted = fold(reserved.record, { type: "input.admitted", seq: 6, inputID, kind: "synthetic" })
    expect(admitted.record.execution.reservation?.status).toBe("admitted")
  })

  test("promoting the continuation marks the drive and clears the reservation", () => {
    const record = activeGoal()
    const reserved = fold(record, { type: "execution.succeeded", seq: 5, eventID: "evt_abc" })
    const inputID = reserved.record.execution.reservation!.inputID
    const admitted = fold(reserved.record, { type: "input.admitted", seq: 6, inputID, kind: "synthetic" })
    const promoted = fold(admitted.record, { type: "input.promoted", seq: 7, inputID })
    expect(promoted.record.execution.drive).toBe("continuation")
    expect(promoted.record.execution.reservation).toBeUndefined()
  })

  test("promoting a user input marks user drive", () => {
    const record = activeGoal()
    const admitted = fold(record, { type: "input.admitted", seq: 5, inputID: "msg_user1", kind: "user" })
    const promoted = fold(admitted.record, { type: "input.promoted", seq: 6, inputID: "msg_user1" })
    expect(promoted.record.execution.drive).toBe("user")
  })
})

describe("interruption and failure", () => {
  test("user interruption pauses", () => {
    const result = fold(activeGoal(), { type: "execution.interrupted", seq: 5, reason: "user" })
    expect(result.record.state).toBe("paused")
    expect(result.record.stop?.code).toBe("interrupted_by_user")
  })

  test("superseded and shutdown do not pause", () => {
    for (const reason of ["superseded", "shutdown"] as const) {
      const result = fold(activeGoal(), { type: "execution.interrupted", seq: 5, reason })
      expect(result.record.state).toBe("active")
    }
  })

  test("failed execution pauses with the failure detail", () => {
    const result = fold(activeGoal(), { type: "execution.failed", seq: 5, detail: "provider exploded" })
    expect(result.record.state).toBe("paused")
    expect(result.record.stop?.code).toBe("execution_failed")
  })
})

describe("step accounting", () => {
  test("exact step usage drives token totals", () => {
    const result = fold(activeGoal(), {
      type: "step.ended",
      seq: 5,
      tokens: { input: 100, output: 50, reasoning: 25 },
      files: [],
    })
    expect(result.record.window.tokens).toBe(175)
    expect(result.record.lifetime.tokens).toBe(175)
    expect(result.record.window.steps).toBe(1)
  })

  test("stall counters apply only to continuation-driven steps", () => {
    const record = activeGoal()
    const userStep = fold(record, { type: "step.ended", seq: 5, files: [] })
    expect(userStep.record.window.stalledSteps).toBe(0)

    const driven = structuredClone(record)
    driven.execution.drive = "continuation"
    const stalled = fold(driven, { type: "step.ended", seq: 5, files: [] })
    expect(stalled.record.window.stalledSteps).toBe(1)
    expect(stalled.record.window.toolFreeSteps).toBe(1)
  })

  test("tool success and changed files reset stall counters", () => {
    const record = activeGoal()
    record.execution.drive = "continuation"
    record.window.stalledSteps = 1
    record.window.toolFreeSteps = 1
    const withTool = fold(record, { type: "step.ended", seq: 5, files: [] }, flags(true))
    expect(withTool.record.window.stalledSteps).toBe(0)
    expect(withTool.record.window.toolFreeSteps).toBe(0)

    const withFiles = fold(record, { type: "step.ended", seq: 5, files: ["src/a.ts"] })
    expect(withFiles.record.window.stalledSteps).toBe(0)
    expect(withFiles.record.latestProgress?.detail).toContain("src/a.ts")
    // Changed files without a tool success still count as tool-free.
    expect(withFiles.record.window.toolFreeSteps).toBe(2)
  })

  test("failed steps account available usage without progress", () => {
    const result = fold(activeGoal(), { type: "step.failed", seq: 5, tokens: { input: 10, output: 0, reasoning: 0 } })
    expect(result.record.window.tokens).toBe(10)
    expect(result.record.window.steps).toBe(1)
  })
})

describe("event fencing", () => {
  test("events at or below the handled seq are no-ops", () => {
    const record = activeGoal()
    const first = fold(record, { type: "step.ended", seq: 5, files: [] })
    const replay = fold(first.record, { type: "step.ended", seq: 5, files: [] })
    expect(replay.effects).toEqual([])
    expect(replay.record.window.steps).toBe(1)
    const older = fold(first.record, { type: "step.ended", seq: 4, files: [] })
    expect(older.effects).toEqual([])
  })

  test("session deletion produces the delete effect", () => {
    const result = fold(activeGoal(), { type: "deleted", seq: 5 })
    expect(result.effects).toEqual(["delete"])
  })
})
