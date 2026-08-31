import { describe, expect, test } from "bun:test"
import {
  DEFAULT_LIMITS,
  bindingLimit,
  blockGoal,
  completeGoal,
  createGoal,
  limitGoal,
  pauseGoal,
  resumeWindow,
  validateClaim,
  validateDefinition,
} from "../src/state"

const NOW = 1_000_000

function activeGoal(criteria: string[] = ["tests pass"]) {
  return createGoal({
    sessionID: "ses_test",
    location: "/tmp/project",
    definition: { objective: "fix the failing tests", successCriteria: criteria, constraints: ["no API changes"], references: [] },
    limits: DEFAULT_LIMITS,
    now: NOW,
  })
}

describe("lifecycle transitions", () => {
  test("createGoal starts active with one window and a created history entry", () => {
    const record = activeGoal()
    expect(record.state).toBe("active")
    expect(record.version).toBe(1)
    expect(record.window.continuations).toBe(0)
    expect(record.history.map((entry) => entry.code)).toEqual(["created"])
    expect(record.mutation).toBe(1)
  })

  test("pause closes the window into lifetime duration and records a stop", () => {
    const record = activeGoal()
    const paused = pauseGoal(record, "user_pause", "paused by user", NOW + 60_000)
    expect(paused.state).toBe("paused")
    expect(paused.stop?.code).toBe("user_pause")
    expect(paused.lifetime.durationMs).toBe(60_000)
    expect(record.state).toBe("active")
  })

  test("resume starts a fresh window and preserves lifetime accounting", () => {
    const record = activeGoal()
    record.window.tokens = 5000
    record.lifetime.tokens = 5000
    const paused = pauseGoal(record, "user_pause", "", NOW + 1000)
    const resumed = resumeWindow(paused, DEFAULT_LIMITS, NOW + 2000)
    expect(resumed.state).toBe("active")
    expect(resumed.window.tokens).toBe(0)
    expect(resumed.window.id).not.toBe(record.window.id)
    expect(resumed.lifetime.tokens).toBe(5000)
    expect(resumed.stop).toBeUndefined()
  })

  test("block records the blocker and stops the window", () => {
    const blocked = blockGoal(activeGoal(), { reason: "needs a production token", needed: "provide token" }, NOW + 10)
    expect(blocked.state).toBe("blocked")
    expect(blocked.blocker?.reason).toBe("needs a production token")
    expect(blocked.stop?.code).toBe("blocked")
  })

  test("complete stores the immutable claim", () => {
    const record = activeGoal()
    const validated = validateClaim(record, {
      summary: "done",
      criteria: [{ criterion: "tests pass", evidence: "bun test: 10 passed" }],
      checks: [{ name: "bun test", status: "passed" }],
    })
    expect(validated.claim).toBeDefined()
    const completed = completeGoal(record, validated.claim!, NOW + 10)
    expect(completed.state).toBe("completed")
    expect(completed.completion?.summary).toBe("done")
    expect(completed.stop).toBeUndefined()
  })

  test("limit transition records the binding limit", () => {
    const record = activeGoal()
    const limited = limitGoal(record, { limit: "tokens", used: 201_044, maximum: 200_000 }, NOW + 10)
    expect(limited.state).toBe("limited")
    expect(limited.stop?.code).toBe("limit_tokens")
    expect(limited.stop?.detail).toBe("201044 of 200000")
  })
})

describe("binding limits", () => {
  test("no limit binds on a fresh goal", () => {
    expect(bindingLimit(activeGoal(), NOW)).toBeUndefined()
  })

  test("token limit binds at the threshold", () => {
    const record = activeGoal()
    record.window.tokens = 200_000
    expect(bindingLimit(record, NOW)?.limit).toBe("tokens")
  })

  test("duration limit binds after the window elapses", () => {
    const record = activeGoal()
    expect(bindingLimit(record, NOW + 900_000)?.limit).toBe("durationMs")
    expect(bindingLimit(record, NOW + 899_999)).toBeUndefined()
  })

  test("null limit means disabled", () => {
    const record = createGoal({
      sessionID: "ses_test",
      location: "/tmp",
      definition: { objective: "x", successCriteria: [], constraints: [], references: [] },
      limits: { ...DEFAULT_LIMITS, tokens: null },
      now: NOW,
    })
    record.window.tokens = 10_000_000
    expect(bindingLimit(record, NOW)).toBeUndefined()
  })

  test("consecutive no-progress steps bind", () => {
    const record = activeGoal()
    record.window.stalledSteps = 2
    expect(bindingLimit(record, NOW)?.limit).toBe("noProgressSteps")
  })
})

describe("definition validation", () => {
  test("requires a non-empty objective", () => {
    expect(validateDefinition({}).problems).toContain("objective must be a non-empty string")
    expect(validateDefinition({ objective: "   " }).problems.length).toBeGreaterThan(0)
  })

  test("bounds objective and criteria", () => {
    expect(validateDefinition({ objective: "x".repeat(4001) }).problems[0]).toContain("4000")
    const criteria = Array.from({ length: 41 }, (_, index) => `criterion ${index}`)
    expect(validateDefinition({ objective: "ok", success_criteria: criteria }).problems[0]).toContain("40")
    const forty = Array.from({ length: 40 }, (_, index) => `criterion ${index}`)
    expect(validateDefinition({ objective: "ok", success_criteria: forty }).value).toBeDefined()
  })

  test("accepts a full definition", () => {
    const result = validateDefinition({
      objective: "migrate auth",
      success_criteria: ["tests pass"],
      constraints: ["no API changes"],
      references: ["goals/migrate-auth/plan.md", "goals/migrate-auth/facts.md"],
    })
    expect(result.value).toEqual({
      objective: "migrate auth",
      successCriteria: ["tests pass"],
      constraints: ["no API changes"],
      references: ["goals/migrate-auth/plan.md", "goals/migrate-auth/facts.md"],
    })
  })

  test("references must be safe relative paths", () => {
    const define = (references: string[]) => validateDefinition({ objective: "ok", references })
    expect(define(["/etc/passwd"]).problems.some((problem) => problem.includes("relative"))).toBe(true)
    expect(define(["goals/../../secret.md"]).problems.some((problem) => problem.includes("relative"))).toBe(true)
    expect(define(["a.md", "a.md"]).problems.some((problem) => problem.includes("unique"))).toBe(true)
    expect(define(Array.from({ length: 11 }, (_, index) => `doc${index}.md`)).problems[0]).toContain("10")
  })
})

describe("completion claim validation", () => {
  test("rejects a criterion without evidence", () => {
    const record = activeGoal(["tests pass", "typecheck passes"])
    const result = validateClaim(record, {
      summary: "done",
      criteria: [{ criterion: "tests pass", evidence: "bun test ok" }],
    })
    expect(result.claim).toBeUndefined()
    expect(result.problems.some((problem) => problem.includes("typecheck passes"))).toBe(true)
  })

  test("rejects empty evidence", () => {
    const result = validateClaim(activeGoal(), {
      summary: "done",
      criteria: [{ criterion: "tests pass", evidence: "   " }],
    })
    expect(result.problems.some((problem) => problem.includes("empty evidence"))).toBe(true)
  })

  test("rejects failed checks", () => {
    const result = validateClaim(activeGoal(), {
      summary: "done",
      criteria: [{ criterion: "tests pass", evidence: "ok" }],
      checks: [{ name: "bun test", status: "failed", detail: "2 failed" }],
    })
    expect(result.problems.some((problem) => problem.includes("checks failed"))).toBe(true)
  })

  test("not_run checks require limitations", () => {
    const base = {
      summary: "done",
      criteria: [{ criterion: "tests pass", evidence: "ok" }],
      checks: [{ name: "bun typecheck", status: "not_run" }],
    }
    expect(validateClaim(activeGoal(), base).problems.some((problem) => problem.includes("not_run"))).toBe(true)
    expect(validateClaim(activeGoal(), { ...base, limitations: ["typecheck skipped: sandbox"] }).claim).toBeDefined()
  })

  test("criterion matching is normalized and exact-once", () => {
    const record = activeGoal(["Tests  Pass"])
    const once = validateClaim(record, {
      summary: "done",
      criteria: [{ criterion: "tests pass", evidence: "ok" }],
    })
    expect(once.claim).toBeDefined()
    const twice = validateClaim(record, {
      summary: "done",
      criteria: [
        { criterion: "tests pass", evidence: "ok" },
        { criterion: "TESTS PASS", evidence: "ok again" },
      ],
    })
    expect(twice.problems.some((problem) => problem.includes("2 times"))).toBe(true)
  })

  test("rejects unknown criteria", () => {
    const result = validateClaim(activeGoal(), {
      summary: "done",
      criteria: [
        { criterion: "tests pass", evidence: "ok" },
        { criterion: "invented extra", evidence: "made up" },
      ],
    })
    expect(result.problems.some((problem) => problem.includes("unknown criterion"))).toBe(true)
  })

  test("rejects absolute, traversal, and duplicate file paths", () => {
    const claim = (files: string[]) =>
      validateClaim(activeGoal(), {
        summary: "done",
        criteria: [{ criterion: "tests pass", evidence: "ok" }],
        changed_files: files,
      })
    expect(claim(["/etc/passwd"]).problems.some((problem) => problem.includes("relative"))).toBe(true)
    expect(claim(["src/../secret"]).problems.some((problem) => problem.includes("relative"))).toBe(true)
    expect(claim(["a.ts", "a.ts"]).problems.some((problem) => problem.includes("unique"))).toBe(true)
    expect(claim(["src/ok.ts"]).claim).toBeDefined()
  })

  test("rejects oversized claims", () => {
    const result = validateClaim(activeGoal(), {
      summary: "done",
      criteria: [{ criterion: "tests pass", evidence: "x".repeat(2000) }],
      limitations: Array.from({ length: 20 }, () => "y".repeat(1999)),
    })
    expect(result.problems.some((problem) => problem.includes("encoded bytes"))).toBe(true)
  })
})
