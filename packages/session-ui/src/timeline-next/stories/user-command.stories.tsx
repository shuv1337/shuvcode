import type { SessionMessageShell } from "@opencode/client/promise"
import { createSignal } from "solid-js"
import { DataProvider } from "../../context/data"
import { ShellMessage } from "../tools/shell"

/**
 * A command the user ran, drawn by the New timeline. It starts running and keeps how it ended in its metadata, which is
 * where the row reads the exit code, a timeout, or that the command was stopped.
 */
export default {
  title: "OpenCode/Timeline/Next user command",
  id: "timeline-next-user-command",
  component: ShellMessage,
  parameters: { layout: "fullscreen" },
}

export const LiveCommand = {
  args: { outcome: "nonzero", output: false },
  argTypes: {
    outcome: { control: "select", options: ["nonzero", "timeout", "killed"] },
    output: { control: "boolean" },
  },
  render: (args: { outcome: "nonzero" | "timeout" | "killed"; output: boolean }) => {
    const [message, setMessage] = createSignal<SessionMessageShell>({
      id: "msg_user_command",
      type: "shell",
      shellID: "shell_user_command",
      command: "printf ready",
      status: "running",
      time: { created: 1 },
    })

    return (
      <section class="mx-auto flex w-full max-w-[720px] flex-col gap-4 p-6">
        <button
          type="button"
          onClick={() =>
            setMessage((value) => ({
              ...value,
              status: args.outcome,
              exit: args.outcome === "nonzero" ? 1 : undefined,
              output: args.output ? { output: "ready\n", cursor: 6, size: 6, truncated: false } : undefined,
              time: { created: 1, completed: 2 },
            }))
          }
        >
          Complete command
        </button>
        <DataProvider directory="/workspace" data={{ session: [], session_status: {}, session_diff: {} }}>
          <ShellMessage message={message()} />
        </DataProvider>
      </section>
    )
  },
}
