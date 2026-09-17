import { describe, expect, test } from "bun:test"
import { Claude } from "../src/claude"
import { Codex } from "../src/codex"
import { Google } from "../src/google"
import { XAI } from "../src/xai"

const RESET = 1_790_000_000

describe("Codex.normalize", () => {
  test("live wham/usage shape: weekly-only primary window, prolite plan", () => {
    const result = Codex.normalize({
      email: "user@example.test",
      plan_type: "prolite",
      rate_limit: {
        primary_window: { used_percent: 93, limit_window_seconds: 604_800, reset_after_seconds: 12_345, reset_at: RESET },
        secondary_window: null,
      },
    })
    expect(result?.plan).toBe("Pro 20x")
    expect(result?.windows).toEqual([{ id: "weekly", label: "Weekly", remaining: 7, resetsAt: RESET * 1000 }])
  })

  test("5h primary + weekly secondary, resets_at fallback and reset_after_seconds fallback", () => {
    const before = Date.now()
    const result = Codex.normalize({
      plan_type: "plus",
      rate_limit: {
        primary_window: { used_percent: 40, limit_window_seconds: 18_000, resets_at: RESET },
        secondary_window: { used_percent: 10, limit_window_seconds: 604_800, reset_after_seconds: 3600 },
      },
    })
    expect(result?.plan).toBe("Plus")
    expect(result?.windows).toHaveLength(2)
    expect(result?.windows[0]).toEqual({ id: "session", label: "5h", remaining: 60, resetsAt: RESET * 1000 })
    expect(result?.windows[1]?.id).toBe("weekly")
    expect(result?.windows[1]?.remaining).toBe(90)
    expect(result?.windows[1]?.resetsAt).toBeGreaterThanOrEqual(before + 3_600_000)
  })

  test("dedupes two weekly windows and humanizes unknown plans", () => {
    const result = Codex.normalize({
      plan_type: "some_new_plan",
      rate_limit: {
        primary_window: { used_percent: 1, limit_window_seconds: 604_800 },
        secondary_window: { used_percent: 2, limit_window_seconds: 604_800 },
      },
    })
    expect(result?.windows.map((w) => w.id)).toEqual(["weekly"])
    expect(result?.plan).toBe("Some New Plan")
  })

  test("accepts nested usage object and remaining_percent", () => {
    const result = Codex.normalize({ usage: { primary: { remaining_percent: 55 } } })
    expect(result?.windows).toEqual([{ id: "session", label: "5h", remaining: 55 }])
  })

  test("returns undefined for empty or non-object payloads", () => {
    expect(Codex.normalize(null)).toBeUndefined()
    expect(Codex.normalize("nope")).toBeUndefined()
    expect(Codex.normalize({})).toBeUndefined()
  })
})

describe("Claude.normalize", () => {
  test("five_hour/seven_day with ratio utilization and model-scoped weekly", () => {
    const iso = "2026-09-20T12:00:00Z"
    const windows = Claude.normalize({
      five_hour: { utilization: 0.35, resets_at: iso },
      seven_day: { utilization: 80, resets_at: iso },
      seven_day_opus: { utilization: 12 },
    })
    expect(windows).toEqual([
      { id: "session", label: "5h", remaining: 65, resetsAt: Date.parse(iso) },
      { id: "weekly", label: "Weekly", remaining: 20, resetsAt: Date.parse(iso) },
      { id: "model:opus:weekly", label: "Opus weekly", remaining: 88 },
    ])
  })

  test("limits[] array with session, weekly_all and scoped model limits", () => {
    const windows = Claude.normalize({
      limits: [
        { group: "session", percent: 10 },
        { kind: "weekly_all", group: "weekly", percent: 50 },
        { group: "weekly", kind: "weekly_model", scope: { model: "claude-opus-4" }, percent: 25 },
        { group: "weekly", kind: "weekly_model", scope: { model: { display_name: "Sonnet" } }, percent: 5 },
        { kind: "mystery_thing", percent: 0 },
      ],
    })
    expect(windows.map((w) => [w.id, w.label, w.remaining])).toEqual([
      ["session", "5h", 90],
      ["weekly", "Weekly", 50],
      ["model:claude opus 4:weekly", "Claude Opus 4 weekly", 75],
      ["model:sonnet:weekly", "Sonnet weekly", 95],
      ["limit:mystery_thing", "Mystery Thing", 100],
    ])
  })

  test("dedupes limits already present as five_hour/seven_day", () => {
    const windows = Claude.normalize({
      five_hour: { utilization: 10 },
      limits: [{ group: "session", percent: 99 }],
    })
    expect(windows).toEqual([{ id: "session", label: "5h", remaining: 90 }])
  })

  test("returns empty for non-object payloads", () => {
    expect(Claude.normalize(undefined)).toEqual([])
    expect(Claude.normalize([])).toEqual([])
    expect(Claude.normalize({})).toEqual([])
  })
})

describe("Claude.plan", () => {
  test("maps subscription types and falls back to humanized", () => {
    expect(Claude.plan({ access: "x", metadata: { subscriptionType: "default_claude_max_20x" } })).toBe("Max 20x")
    expect(Claude.plan({ access: "x", metadata: { rateLimitTier: "pro" } })).toBe("Pro")
    expect(Claude.plan({ access: "x", metadata: { subscriptionType: "team_plus" } })).toBe("Team Plus")
    expect(Claude.plan({ access: "x" })).toBeUndefined()
  })
})

describe("XAI.normalize", () => {
  const period = {
    type: "USAGE_PERIOD_TYPE_WEEKLY",
    start: "2026-09-14T00:00:00Z",
    end: "2026-09-21T00:00:00Z",
  }

  test("weekly credit window from creditUsagePercent and currentPeriod.end", () => {
    expect(XAI.normalize({ config: { creditUsagePercent: 30, currentPeriod: period } })).toEqual([
      { id: "weekly", label: "Weekly", remaining: 70, resetsAt: Date.parse(period.end) },
    ])
  })

  test("missing creditUsagePercent is treated as zero only when the period matches the billing period", () => {
    const matched = XAI.normalize({
      config: { billingPeriodStart: period.start, billingPeriodEnd: period.end, currentPeriod: period },
    })
    expect(matched).toEqual([{ id: "weekly", label: "Weekly", remaining: 100, resetsAt: Date.parse(period.end) }])

    const mismatched = XAI.normalize({
      config: { billingPeriodStart: "2026-09-01T00:00:00Z", billingPeriodEnd: "2026-09-08T00:00:00Z", currentPeriod: period },
    })
    expect(mismatched).toEqual([])
  })

  test("monthly/daily/unknown period types and billingPeriodEnd fallback", () => {
    expect(XAI.normalize({ config: { creditUsagePercent: 5, periodType: "USAGE_PERIOD_TYPE_MONTHLY", billingPeriodEnd: period.end } })).toEqual([
      { id: "monthly", label: "Monthly", remaining: 95, resetsAt: Date.parse(period.end) },
    ])
    expect(XAI.normalize({ config: { creditUsagePercent: 5, periodType: "USAGE_PERIOD_TYPE_DAILY" } })).toEqual([
      { id: "daily", label: "Daily", remaining: 95 },
    ])
    expect(XAI.normalize({ config: { creditUsagePercent: 120 } })).toEqual([{ id: "credits", label: "Credits", remaining: 0 }])
  })

  test("returns empty without config", () => {
    expect(XAI.normalize({})).toEqual([])
    expect(XAI.normalize(null)).toEqual([])
  })
})

describe("XAI.plan / account", () => {
  const jwt = (payload: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`

  test("reads tier and email from the JWT, metadata overrides", () => {
    expect(XAI.plan({ access: jwt({ tier: 2 }) })).toBe("SuperGrok")
    expect(XAI.plan({ access: jwt({ tier: 5 }) })).toBe("SuperGrok Heavy")
    expect(XAI.plan({ access: jwt({ tier: 9 }) })).toBe("Tier 9")
    expect(XAI.plan({ access: jwt({}) })).toBeUndefined()
    expect(XAI.plan({ access: jwt({ tier: 1 }), metadata: { plan: "Custom" } })).toBe("Custom")
    expect(XAI.account({ access: jwt({ email: "j@x.test" }) })).toBe("j@x.test")
    expect(XAI.account({ access: jwt({ email: "j@x.test" }), metadata: { email: "meta@x.test" } })).toBe("meta@x.test")
  })
})

describe("Google.normalize", () => {
  const reset = "2026-09-18T03:00:00Z"

  test("groups gemini and 3p buckets by window with tier plan", () => {
    const result = Google.normalize({
      paidTier: "g1-pro-tier",
      groups: [
        {
          displayName: "Gemini models",
          buckets: [
            { window: "5h", remainingFraction: 0.5, resetTime: reset },
            { window: "weekly", remainingFraction: 0.9 },
          ],
        },
        {
          displayName: "Claude and GPT models",
          buckets: [{ window: "5h", remainingFraction: 0.1, resetTime: reset }],
        },
      ],
    })
    expect(result?.plan).toBe("Google AI Pro")
    expect(result?.windows).toEqual([
      { id: "gemini:5h", label: "Gemini 5h", remaining: 50, resetsAt: Date.parse(reset) },
      { id: "gemini:weekly", label: "Gemini weekly", remaining: 90 },
      { id: "3p:5h", label: "Claude+GPT 5h", remaining: 10, resetsAt: Date.parse(reset) },
    ])
  })

  test("snake_case fields, unknown groups/windows, dedupe, and humanized tier", () => {
    const result = Google.normalize({
      paid_tier: "g1-mystery-tier",
      groups: [
        {
          id: "grp-x",
          buckets: [
            { bucket_id: "b1", display_name: "Daily", remaining_fraction: 0.25, reset_time: reset },
            { bucket_id: "b1", remaining_fraction: 0.99 },
            { window: "5h" },
          ],
        },
      ],
    })
    expect(result?.plan).toBe("G1 Mystery Tier")
    expect(result?.windows).toEqual([{ id: "grp-x:b1", label: "Models 1 Daily", remaining: 25, resetsAt: Date.parse(reset) }])
  })

  test("returns undefined without usable buckets", () => {
    expect(Google.normalize({})).toBeUndefined()
    expect(Google.normalize({ groups: [] })).toBeUndefined()
    expect(Google.normalize({ groups: [{ buckets: [{ window: "5h" }] }] })).toBeUndefined()
    expect(Google.normalize(null)).toBeUndefined()
  })
})
