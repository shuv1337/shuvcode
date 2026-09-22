import { Plugin } from "@opencode/plugin/tui"
import { createMemo, Show } from "solid-js"
import { contextUsage } from "../../util/session"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

type Collapsed = { root: boolean }

function compactTokens(tokens: number) {
  if (tokens >= 1_000_000) {
    const millions = Math.round((tokens / 1_000_000) * 10) / 10
    return `${Number.isInteger(millions) ? millions.toFixed(0) : millions}M`
  }
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`
  return String(tokens)
}

export function SidebarContext(props: { context: Plugin.Context; sessionID: string }) {
  const theme = props.context.theme
  const msg = createMemo(() => props.context.data.session.message.list(props.sessionID))
  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  const cost = createMemo(() => props.context.data.session.cost(props.sessionID))
  const [collapsed, setCollapsed] = props.context.storage.store<Collapsed>("collapsed", {
    initial: { root: false },
  })

  const state = createMemo(() =>
    contextUsage(msg(), props.context.data.location.model.list(session()?.location), session()?.revert?.messageID),
  )
  const open = () => !collapsed.root
  const summary = createMemo(() => {
    const usage = state()
    if (usage) {
      const tokens = compactTokens(usage.tokens)
      return usage.percent === undefined ? tokens : `${tokens} ${usage.percent}%`
    }
    if (cost() > 0) return money.format(cost())
    return ""
  })

  return (
    <Show when={state() || cost() > 0}>
      <box>
        <box
          flexDirection="row"
          gap={1}
          minWidth={0}
          onMouseDown={() => void setCollapsed((draft) => void (draft.root = !draft.root))}
        >
          <text fg={theme.text.base} flexShrink={0}>
            {open() ? "▼" : "▶"}
          </text>
          <text fg={theme.text.base} wrapMode="none" truncate flexGrow={1} flexShrink={1} minWidth={0}>
            <b>Context</b>
            <Show when={!open() && summary()}>
              <span style={{ fg: theme.text.muted }}> {summary()}</span>
            </Show>
          </text>
        </box>
        <Show when={open()}>
          <Show when={state()}>
            {(value) => (
              <>
                <text fg={theme.text.muted}>{value().tokens.toLocaleString()} tokens</text>
                <Show when={value().percent !== undefined}>
                  <text fg={theme.text.muted}>{value().percent}% used</text>
                </Show>
              </>
            )}
          </Show>
          <Show when={cost() > 0}>
            <text fg={theme.text.muted}>{money.format(cost())} spent</text>
          </Show>
        </Show>
      </box>
    </Show>
  )
}

export default Plugin.define({
  id: "opencode.sidebar.context",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <SidebarContext context={context} sessionID={props.sessionID} />,
    })
  },
})
