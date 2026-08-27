import { createSignal } from "solid-js"
import { CurrentSessionProviders } from "../storybook/current-session-story"
import { storyDocument, storyTool } from "../storybook/current-session-scenarios"
import { CurrentContextToolGroup } from "./tool-renderer"

export default {
  title: "OpenCode/Work/Tool group",
  id: "current-tool-group",
  component: CurrentContextToolGroup,
}

export const MixedTools = {
  render: () => {
    const [open, setOpen] = createSignal(true)
    const tools = [
      storyTool(
        "group_shell",
        "shell",
        "completed",
        { command: "printf 'group geometry'" },
        { output: "group geometry" },
      ),
      storyTool("group_read", "read", "completed", { path: "src/group.ts" }),
      storyTool("group_general", "subagent", "completed", { agent: "general", description: "Inspect grouped tools" }),
      storyTool("group_explore", "subagent", "completed", { agent: "explore", description: "Check card geometry" }),
    ]
    return (
      <section style={{ width: "100%", "max-width": "720px", padding: "24px" }}>
        <CurrentSessionProviders document={storyDocument(tools)}>
          <CurrentContextToolGroup tools={tools} busy={false} open={open()} onOpenChange={setOpen} />
        </CurrentSessionProviders>
      </section>
    )
  },
}
