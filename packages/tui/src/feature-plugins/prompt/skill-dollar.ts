import { Plugin } from "@opencode-ai/plugin/tui"
import type { PromptAutocompleteOption } from "@opencode-ai/plugin/tui/context"

type SkillOption = { readonly id: string; readonly description?: string }

export function skillDollarOptions(skills: readonly SkillOption[], query: string): PromptAutocompleteOption[] {
  const needle = query.toLowerCase()
  return skills
    .filter((skill) => !needle || `${skill.id} ${skill.description ?? ""}`.toLowerCase().includes(needle))
    .toSorted((a, b) => {
      const score = (skill: SkillOption) => {
        const id = skill.id.toLowerCase()
        if (id === needle) return 0
        if (id.startsWith(needle)) return 1
        if (id.includes(needle)) return 2
        return 3
      }
      return score(a) - score(b) || a.id.localeCompare(b.id)
    })
    .slice(0, 20)
    .map((skill) => ({
      value: skill.id,
      display: `$${skill.id}`,
      description: skill.description,
      skill: skill.id,
    }))
}

export default Plugin.define({
  id: "shuv.skill-dollar",
  async setup(context) {
    await context.data.location.skill.sync(context.location)
    return context.ui.prompt.autocomplete.register({
      trigger: "$",
      options: ({ query, location }) => skillDollarOptions(context.data.location.skill.list(location) ?? [], query),
    })
  },
})
