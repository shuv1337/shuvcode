import { expect, test } from "bun:test"
import SkillDollar, { skillDollarActive, skillDollarOptions } from "../../src/feature-plugins/prompt/skill-dollar"
import { builtins } from "../../src/plugin/builtins"
import { referenceMentionOptions } from "../../src/component/prompt/autocomplete"

const skill = (id: string, description?: string) => ({ id, description })

test("ships as the skill dollar builtin", () => {
  expect(SkillDollar.id).toBe("shuv.skill-dollar")
  expect(builtins).toContain(SkillDollar)
})

test("hides @ skills only while the dollar skill provider is active", () => {
  expect(skillDollarActive([])).toBe(false)
  expect(skillDollarActive([{ id: "another-plugin", provider: { trigger: "$" } }])).toBe(false)
  expect(skillDollarActive([{ id: "shuv.skill-dollar", provider: { trigger: "@" } }])).toBe(false)
  expect(skillDollarActive([{ id: "shuv.skill-dollar", provider: { trigger: "$" } }])).toBe(true)
})

test("@ autocomplete restores skills after the dollar provider is removed and preserves other mentions", () => {
  const options = {
    terminal: [{ display: "@terminal" }],
    skills: [{ display: "@research" }],
    references: [{ display: "@docs" }],
    agents: [{ display: "@build" }],
  }
  const active = [{ id: "shuv.skill-dollar", provider: { trigger: "$" } }]
  expect(referenceMentionOptions({ ...options, providers: active }).map((item) => item.display)).toEqual([
    "@terminal",
    "@docs",
    "@build",
  ])
  expect(referenceMentionOptions({ ...options, providers: [] }).map((item) => item.display)).toEqual([
    "@terminal",
    "@research",
    "@docs",
    "@build",
  ])
})

test("filters and ranks skill matches", () => {
  const options = skillDollarOptions(
    [
      skill("code-review", "Review a change"),
      skill("review-plan", "Check a plan"),
      skill("fresh-eyes", "Independent review"),
      skill("research", "Investigate a topic"),
    ],
    "review",
  )

  expect(options.map((option) => option.value)).toEqual(["review-plan", "code-review", "fresh-eyes"])
  expect(options[0]).toEqual({
    value: "review-plan",
    display: "$review-plan",
    description: "Check a plan",
    skill: "review-plan",
  })
})

test("sorts empty queries and limits the menu", () => {
  const options = skillDollarOptions(
    Array.from({ length: 25 }, (_, index) => skill(`skill-${String(24 - index).padStart(2, "0")}`)),
    "",
  )

  expect(options).toHaveLength(20)
  expect(options[0]?.value).toBe("skill-00")
  expect(options[19]?.value).toBe("skill-19")
})
