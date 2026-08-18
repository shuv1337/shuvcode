import { expect, test } from "bun:test"
import SkillDollar, { skillDollarOptions } from "../../src/feature-plugins/prompt/skill-dollar"
import { builtins } from "../../src/plugin/builtins"

const skill = (id: string, description?: string) => ({ id, description })

test("ships as the skill dollar builtin", () => {
  expect(SkillDollar.id).toBe("shuv.skill-dollar")
  expect(builtins).toContain(SkillDollar)
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
