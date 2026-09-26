import { Plugin } from "@opencode/plugin/tui"
import type { SessionInfo } from "@opencode/client"
import { createMemo, For, onCleanup, Show } from "solid-js"
import { isShallowEqual } from "remeda"
import { displayLabel } from "@opencode/util/session-title-fallback"
import { Locale } from "../../util/locale"
import { sessionFamily } from "../../util/session"

type Collapsed = { root: boolean }

export function SidebarSubagents(props: { context: Plugin.Context; sessionID: string }) {
  const theme = props.context.theme
  let navigation = 0
  onCleanup(() => navigation++)
  const navigate = async (sessionID: string) => {
    const request = ++navigation
    const previous = props.sessionID
    // Context rows depend on messages. Load them before changing the sidebar's
    // session so a first visit cannot collapse and re-expand those rows.
    await Promise.all([props.context.data.session.sync(sessionID), props.context.data.session.message.sync(sessionID)])
    if (request !== navigation || props.sessionID !== previous) return
    props.context.ui.router.navigate({ type: "session", sessionID })
  }
  const [collapsed, setCollapsed] = props.context.storage.store<Collapsed>("collapsed", {
    initial: { root: false },
  })
  const related = createMemo(
    () => {
      const sessions = props.context.data.session.list()
      const current = props.context.data.session.get(props.sessionID)
      const items = current?.parentID
        ? sessionFamily(sessions, props.sessionID).map(({ session }) => session)
        : sessions.filter((session) => session.parentID === props.sessionID)
      return items.toSorted((a, b) => a.time.created - b.time.created)
    },
    undefined,
    { equals: isShallowEqual },
  )
  const groups = createMemo(() => {
    const map = new Map<string, SessionInfo[]>()
    related().forEach((session) => {
      const agent = label(session).agent
      const group = map.get(agent)
      if (!group) {
        map.set(agent, [session])
        return
      }
      group.push(session)
    })
    return [...map.entries()]
  })
  const running = createMemo(
    () => related().filter((session) => props.context.data.session.status(session.id) === "running").length,
  )
  const open = () => !collapsed.root
  const summary = createMemo(() => {
    const finished = related().length - running()
    return `(${[running() > 0 && `${running()} running`, finished > 0 && `${finished} done`].filter(Boolean).join(", ")})`
  })

  return (
    <Show when={related().length > 0}>
      <box id="sidebar-subagents">
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
            <b>Subagents</b>
            <span style={{ fg: theme.text.muted }}> {summary()}</span>
          </text>
        </box>
        <Show when={open()}>
          <For each={groups()}>
            {(group) => (
              <box>
                <box flexDirection="row" gap={1} minWidth={0}>
                  <text
                    flexShrink={0}
                    fg={
                      group[1].some((session) => props.context.data.session.status(session.id) === "running")
                        ? theme.text.feedback.info.base
                        : theme.text.base
                    }
                  >
                    •
                  </text>
                  <text fg={theme.text.base} wrapMode="none" truncate flexGrow={1} flexShrink={1} minWidth={0}>
                    <b>{group[0]}</b>
                  </text>
                </box>
                <For each={group[1]}>
                  {(session) => {
                    const status = props.context.data.session.status(session.id)
                    return (
                      <box
                        flexDirection="row"
                        gap={1}
                        paddingLeft={2}
                        minWidth={0}
                        onMouseUp={() =>
                          void navigate(session.id).catch(() =>
                            props.context.ui.toast.show({
                              variant: "error",
                              message: "Unable to load subagent session",
                            }),
                          )
                        }
                      >
                        <text flexShrink={0} fg={glyphColor(theme, session, status)}>
                          {glyph(session, status)}
                        </text>
                        <text
                          fg={status === "running" ? theme.text.base : theme.text.muted}
                          wrapMode="none"
                          truncate
                          flexGrow={1}
                          flexShrink={1}
                          minWidth={0}
                        >
                          {label(session).description}
                        </text>
                      </box>
                    )
                  }}
                </For>
              </box>
            )}
          </For>
        </Show>
      </box>
    </Show>
  )
}

export default Plugin.define({
  id: "opencode.sidebar.subagents",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <SidebarSubagents context={context} sessionID={props.sessionID} />,
    })
  },
})

function label(session: SessionInfo) {
  const title = displayLabel(session)
  const match = title.match(/@(\w+) subagent/)
  if (session.agent) {
    return {
      agent: Locale.titlecase(session.agent),
      description: match ? title.replace(match[0], "").trim() || title : title,
    }
  }
  if (match) {
    return {
      agent: Locale.titlecase(match[1]),
      description: title.replace(match[0], "").trim() || title,
    }
  }
  return { agent: "Subagent", description: title }
}

function glyph(session: SessionInfo, status: "idle" | "running") {
  if (status === "running") return "●"
  if (session.outcome === "failed") return "✗"
  if (session.outcome === "interrupted") return "○"
  return "✓"
}

function glyphColor(theme: Plugin.Context["theme"], session: SessionInfo, status: "idle" | "running") {
  if (status === "running") return theme.text.feedback.info.base
  if (session.outcome === "failed") return theme.text.feedback.error.base
  if (session.outcome === "interrupted") return theme.text.feedback.warning.base
  return theme.text.muted
}
