import { Plugin } from "@opencode/plugin/tui"
import { QuotaRpc } from "@shuvcode/quota-plugin/rpc"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"

/** Client poll interval. The server caches for longer; this only picks up fresh snapshots. */
const POLL_MS = 60 * 1000
/** Delay before a forced refresh after a sign-in change or completed turn. */
const BUMP_MS = 4 * 1000

type Provider = QuotaRpc.Provider
// Mutable: storage.memory mutations edit a draft of this shape in place.
type State = { providers: readonly Provider[]; loaded: boolean; unavailable: boolean }
// Mutable: storage.store mutations edit a draft of this shape in place.
type Collapsed = { root: boolean; providers: Record<string, boolean> }

function isUnavailable(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    (error.type === "rpc.unavailable" || error.type === "rpc.method_not_found")
  )
}

function formatReset(resetsAt: number | undefined, now: number) {
  if (resetsAt === undefined) return ""
  const delta = Math.max(0, resetsAt - now)
  const minutes = Math.floor(delta / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

function bar(remaining: number, width: number) {
  const filled = Math.round((Math.min(100, Math.max(0, remaining)) / 100) * width)
  return "█".repeat(filled) + "░".repeat(width - filled)
}

export function SidebarQuota(props: { context: Plugin.Context; sessionID: string }) {
  const theme = props.context.theme
  const rpc = props.context.client.rpc(QuotaRpc.Definition)
  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  // Session navigation remounts the sidebar; keeping the last snapshot in memory
  // prevents the section from collapsing and shifting everything below it.
  const [state, setState] = props.context.storage.memory<State>("snapshot", {
    initial: { providers: [], loaded: false, unavailable: false },
  })
  const [now, setNow] = createSignal(Date.now())
  const [collapsed, setCollapsed] = props.context.storage.store<Collapsed>("collapsed", {
    initial: { root: false, providers: {} },
  })

  let generation = 0
  const load = async (refresh = false) => {
    const current = ++generation
    const location = session()?.location
    try {
      const result = await rpc.list({ refresh }, location ? { location } : undefined)
      if (current !== generation) return
      setState((draft) => {
        draft.providers = result.providers
        draft.loaded = true
        draft.unavailable = false
      })
    } catch (error) {
      if (current !== generation) return
      const unavailable = isUnavailable(error)
      setState((draft) => {
        draft.loaded = true
        // Other failures keep the last snapshot; the next poll retries.
        if (!unavailable) return
        draft.providers = []
        draft.unavailable = true
      })
    }
    setNow(Date.now())
  }

  let bump: ReturnType<typeof setTimeout> | undefined
  const schedule = (refresh: boolean) => {
    if (bump) clearTimeout(bump)
    bump = setTimeout(() => void load(refresh), BUMP_MS)
  }

  onMount(() => {
    void load()
    const poll = setInterval(() => void load(), POLL_MS)
    const tick = setInterval(() => setNow(Date.now()), 30_000)
    const offUpdated = props.context.data.on("credential.updated", () => schedule(true))
    const offSwitched = props.context.data.on("credential.switched", () => schedule(true))
    const offDone = props.context.data.on("session.execution.succeeded", (event) => {
      if (props.context.data.session.root(event.data.sessionID) !== props.context.data.session.root(props.sessionID))
        return
      schedule(true)
    })
    onCleanup(() => {
      // The snapshot outlives this view; drop its in-flight result.
      generation++
      clearInterval(poll)
      clearInterval(tick)
      if (bump) clearTimeout(bump)
      offUpdated()
      offSwitched()
      offDone()
    })
  })

  const color = (remaining: number) => {
    if (remaining <= 20) return theme.text.feedback.error.base
    if (remaining <= 60) return theme.text.feedback.warning.base
    return theme.text.feedback.success.base
  }

  const lowest = createMemo(() => {
    const values = state.providers.flatMap((provider) => provider.windows).map((window) => window.remaining)
    return values.length ? Math.min(...values) : undefined
  })
  const errors = createMemo(() => state.providers.filter((provider) => provider.status === "error").length)
  // Fits the 42-cell sidebar: "(7% min, 1 error)" rather than listing providers.
  const summary = createMemo(() => {
    const count = state.providers.length
    const min = lowest()
    const parts = [min === undefined ? `${count} provider${count === 1 ? "" : "s"}` : `${Math.round(min)}% min`]
    if (errors() > 0) parts.push(`${errors()} error${errors() > 1 ? "s" : ""}`)
    return `(${parts.join(", ")})`
  })
  const rootOpen = () => !collapsed.root
  const providerOpen = (id: string) => collapsed.providers[id] !== true
  const toggleRoot = () => void setCollapsed((draft) => void (draft.root = !draft.root))
  const toggleProvider = (id: string) =>
    void setCollapsed((draft) => void (draft.providers[id] = !(draft.providers[id] === true)))

  return (
    <Show when={state.loaded && !state.unavailable && state.providers.length > 0}>
      <box>
        <box flexDirection="row" gap={1} minWidth={0} onMouseDown={toggleRoot}>
          <text fg={theme.text.base} flexShrink={0}>
            {rootOpen() ? "▼" : "▶"}
          </text>
          <text fg={theme.text.base} wrapMode="none" truncate flexGrow={1} flexShrink={1} minWidth={0}>
            <b>Quota</b>
            <Show when={!rootOpen()}>
              <span style={{ fg: theme.text.muted }}> {summary()}</span>
            </Show>
          </text>
        </box>
        <Show when={rootOpen()}>
          <For each={state.providers}>
            {(provider) => {
              const min = createMemo(() =>
                provider.windows.length ? Math.min(...provider.windows.map((window) => window.remaining)) : undefined,
              )
              const dot = () =>
                provider.status === "error"
                  ? theme.text.feedback.error.base
                  : min() === undefined
                    ? theme.text.muted
                    : color(min()!)
              return (
                <box paddingLeft={1}>
                  <box flexDirection="row" gap={1} minWidth={0} onMouseDown={() => toggleProvider(provider.id)}>
                    <text fg={theme.text.base} flexShrink={0}>
                      {providerOpen(provider.id) ? "▼" : "▶"}
                    </text>
                    <text flexShrink={0} fg={dot()}>
                      •
                    </text>
                    <text fg={theme.text.base} wrapMode="none" truncate flexGrow={1} flexShrink={1} minWidth={0}>
                      <b>{provider.name}</b>
                      <Show when={provider.plan}>
                        <span style={{ fg: theme.text.muted }}> {provider.plan}</span>
                      </Show>
                    </text>
                    <Show when={!providerOpen(provider.id)}>
                      <text
                        fg={provider.status === "error" ? theme.text.feedback.error.base : theme.text.muted}
                        wrapMode="none"
                        flexShrink={0}
                      >
                        {provider.status === "error" ? "Error" : min() === undefined ? "" : `${Math.round(min()!)}%`}
                      </text>
                    </Show>
                  </box>
                  <Show when={providerOpen(provider.id)}>
                    <Show when={provider.account}>
                      <box paddingLeft={4}>
                        <text fg={theme.text.muted} wrapMode="none" truncate>
                          {provider.account}
                        </text>
                      </box>
                    </Show>
                    <Show when={provider.status === "error" && provider.error}>
                      <box paddingLeft={4}>
                        <text fg={theme.text.feedback.error.base} wrapMode="none" truncate>
                          {provider.error}
                        </text>
                      </box>
                    </Show>
                    <For each={provider.windows}>
                      {(window) => (
                        <box paddingLeft={4} minWidth={0}>
                          <box flexDirection="row" gap={1} minWidth={0}>
                            <text
                              fg={theme.text.base}
                              wrapMode="none"
                              truncate
                              flexGrow={1}
                              flexShrink={1}
                              minWidth={0}
                            >
                              {window.label}
                            </text>
                            <text fg={color(window.remaining)} wrapMode="none" flexShrink={0}>
                              {Math.round(window.remaining)}% left
                            </text>
                          </box>
                          <box flexDirection="row" gap={1} minWidth={0}>
                            <text fg={color(window.remaining)} wrapMode="none" flexShrink={0}>
                              {bar(window.remaining, 12)}
                            </text>
                            <Show when={window.resetsAt !== undefined}>
                              <text fg={theme.text.muted} wrapMode="none" truncate flexShrink={1} minWidth={0}>
                                resets {formatReset(window.resetsAt, now())}
                              </text>
                            </Show>
                          </box>
                        </box>
                      )}
                    </For>
                  </Show>
                </box>
              )
            }}
          </For>
        </Show>
      </box>
    </Show>
  )
}

export default Plugin.define({
  id: "shuvcode.sidebar.quota",
  setup(context) {
    context.ui.slot({
      prepend: "sidebar.content",
      render: (props) => <SidebarQuota context={context} sessionID={props.sessionID} />,
    })
  },
})
