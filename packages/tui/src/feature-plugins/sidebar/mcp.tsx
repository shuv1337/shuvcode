import { Plugin } from "@opencode-ai/plugin/v2/tui"
import { createMemo, For, Match, Show, Switch, createSignal } from "solid-js"
import { useTheme } from "../../context/theme"

function View(props: { context: Plugin.Context; sessionID: string }) {
  const [open, setOpen] = createSignal(true)
  const { theme } = useTheme()
  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  const list = createMemo(() => props.context.data.location.mcp.server.list(session()?.location) ?? [])
  const on = createMemo(() => list().filter((item) => item.status.status === "connected").length)
  const bad = createMemo(
    () =>
      list().filter(
        (item) =>
          item.status.status === "failed" ||
          item.status.status === "needs_auth" ||
          item.status.status === "needs_client_registration",
      ).length,
  )

  const dot = (status: string) => {
    if (status === "connected") return theme.success
    if (status === "failed") return theme.error
    if (status === "disabled") return theme.textMuted
    if (status === "needs_auth") return theme.warning
    if (status === "needs_client_registration") return theme.error
    return theme.textMuted
  }

  return (
    <Show when={list().length > 0}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => list().length > 2 && setOpen((x) => !x)}>
          <Show when={list().length > 2}>
            <text fg={theme.text}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme.text}>
            <b>MCP</b>
            <Show when={!open()}>
              <span style={{ fg: theme.textMuted }}>
                {" "}
                ({on()} active{bad() > 0 ? `, ${bad()} error${bad() > 1 ? "s" : ""}` : ""})
              </span>
            </Show>
          </text>
        </box>
        <Show when={list().length <= 2 || open()}>
          <For each={list()}>
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text
                  flexShrink={0}
                  style={{
                    fg: dot(item.status.status),
                  }}
                >
                  •
                </text>
                <text fg={theme.text} wrapMode="word">
                  {item.name}{" "}
                  <span style={{ fg: theme.textMuted }}>
                    <Switch fallback={item.status.status}>
                      <Match when={item.status.status === "connected"}>Connected</Match>
                      <Match when={item.status.status === "failed"}>
                        <i>{item.status.status === "failed" ? item.status.error : undefined}</i>
                      </Match>
                      <Match when={item.status.status === "disabled"}>Disabled</Match>
                      <Match when={item.status.status === "needs_auth"}>Needs auth</Match>
                      <Match when={item.status.status === "needs_client_registration"}>Needs client ID</Match>
                    </Switch>
                  </span>
                </text>
              </box>
            )}
          </For>
        </Show>
      </box>
    </Show>
  )
}

export default Plugin.define({
  id: "internal:sidebar-mcp",
  setup(context) {
    context.ui.slot("sidebar.content", (props) => <View context={context} sessionID={props.sessionID} />)
  },
})
