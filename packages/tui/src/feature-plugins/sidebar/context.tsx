import { Plugin } from "@opencode-ai/plugin/v2/tui"
import { createMemo, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { contextUsage } from "../../util/session"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function View(props: { context: Plugin.Context; sessionID: string }) {
  const { theme } = useTheme()
  const msg = createMemo(() => props.context.data.session.message.list(props.sessionID))
  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  const cost = createMemo(() => props.context.data.session.cost(props.sessionID))

  const state = createMemo(() =>
    contextUsage(msg(), props.context.data.location.model.list(session()?.location), session()?.revert?.messageID),
  )

  return (
    <box>
      <text fg={theme.text}>
        <b>Context</b>
      </text>
      <Show when={state()} fallback={<text fg={theme.textMuted}>Not measured</text>}>
        {(value) => (
          <>
            <text fg={theme.textMuted}>{value().tokens.toLocaleString()} tokens</text>
            <Show when={value().percent !== undefined}>
              <text fg={theme.textMuted}>{value().percent}% used</text>
            </Show>
          </>
        )}
      </Show>
      <text fg={theme.textMuted}>{money.format(cost())} spent</text>
    </box>
  )
}

export default Plugin.define({
  id: "internal:sidebar-context",
  setup(context) {
    context.ui.slot("sidebar.content", (props) => <View context={context} sessionID={props.sessionID} />)
  },
})
