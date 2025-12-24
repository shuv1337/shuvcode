import { type Accessor, createMemo, Match, Show, Switch } from "solid-js"
import { useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { pipe, sumBy } from "remeda"
import { useTheme } from "@tui/context/theme"
import { EmptyBorder } from "@tui/component/border"
import type { AssistantMessage, Session } from "@opencode-ai/sdk/v2"
import { useKeybind } from "../../context/keybind"
import { useTerminalDimensions } from "@opentui/solid"

const Title = (props: { session: Accessor<Session>; truncate?: boolean }) => {
  const { theme } = useTheme()
  return (
    <text fg={theme.text} wrapMode={props.truncate ? "none" : undefined} flexShrink={props.truncate ? 1 : 0}>
      <span style={{ bold: true }}>#</span> <span style={{ bold: true }}>{props.session().title}</span>
    </text>
  )
}

const ContextInfo = (props: { context: Accessor<string | undefined>; cost: Accessor<string> }) => {
  const { theme } = useTheme()
  return (
    <Show when={props.context()}>
      <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
        {props.context()} ({props.cost()})
      </text>
    </Show>
  )
}

export function Header() {
  const route = useRouteData("session")
  const sync = useSync()
  const session = createMemo(() => sync.session.get(route.sessionID)!)
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])

  const cost = createMemo(() => {
    const total = pipe(
      messages(),
      sumBy((x) => (x.role === "assistant" ? x.cost : 0)),
    )
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(total)
  })

  const context = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage
    if (!last) return
    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    let result = total.toLocaleString()
    if (model?.limit.context) {
      result += "  " + Math.round((total / model.limit.context) * 100) + "%"
    }
    return result
  })

  const { theme } = useTheme()
  const keybind = useKeybind()
  const dimensions = useTerminalDimensions()
  const tall = createMemo(() => dimensions().height > 40)

  return (
    <box flexShrink={0}>
      <box
        height={1}
        border={["left"]}
        borderColor={theme.border}
        customBorderChars={{
          ...EmptyBorder,
          vertical: theme.backgroundPanel.a !== 0 ? "╻" : " ",
        }}
      >
        <box
          height={1}
          border={["top"]}
          borderColor={theme.backgroundPanel}
          customBorderChars={
            theme.backgroundPanel.a !== 0
              ? {
                  ...EmptyBorder,
                  horizontal: "▄",
                }
              : {
                  ...EmptyBorder,
                  horizontal: " ",
                }
          }
        />
      </box>
      <box
        border={["left"]}
        borderColor={theme.border}
        customBorderChars={{
          ...EmptyBorder,
          vertical: "┃",
          bottomLeft: "╹",
        }}
      >
        <box
          paddingTop={tall() ? 1 : 0}
          paddingBottom={tall() ? 1 : 0}
          paddingLeft={2}
          paddingRight={1}
          flexShrink={0}
          flexGrow={1}
          backgroundColor={theme.backgroundPanel}
        >
          <Switch>
            <Match when={session()?.parentID}>
              <box flexDirection="row" gap={2}>
                <text fg={theme.text}>
                  <b>Subagent session</b>
                </text>
                <text fg={theme.text}>
                  Parent <span style={{ fg: theme.textMuted }}>{keybind.print("session_parent")}</span>
                </text>
                <text fg={theme.text}>
                  Prev <span style={{ fg: theme.textMuted }}>{keybind.print("session_child_cycle_reverse")}</span>
                </text>
                <text fg={theme.text}>
                  Next <span style={{ fg: theme.textMuted }}>{keybind.print("session_child_cycle")}</span>
                </text>
                <box flexGrow={1} flexShrink={1} />
                <ContextInfo context={context} cost={cost} />
              </box>
            </Match>
            <Match when={true}>
              <box flexDirection="row" justifyContent="space-between" gap={1}>
                <Title session={session} truncate={!tall()} />
                <ContextInfo context={context} cost={cost} />
              </box>
            </Match>
          </Switch>
        </box>
      </box>
      <box
        height={1}
        border={["left"]}
        borderColor={theme.border}
        customBorderChars={{
          ...EmptyBorder,
          vertical: theme.backgroundPanel.a !== 0 ? "╹" : " ",
        }}
      >
        <box
          height={1}
          border={["bottom"]}
          borderColor={theme.backgroundPanel}
          customBorderChars={
            theme.backgroundPanel.a !== 0
              ? {
                  ...EmptyBorder,
                  horizontal: "▀",
                }
              : {
                  ...EmptyBorder,
                  horizontal: " ",
                }
          }
        />
      </box>
    </box>
  )
}
