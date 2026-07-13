import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { useConfig } from "../config"
import { useTheme } from "../context/theme"
import { useBindings } from "../keymap"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"

type Setting = {
  title: string
  category: string
  description: string
  detail?: string
  path: string[]
  default: unknown
  values?: readonly unknown[]
  labels?: readonly string[]
  step?: number
  min?: number
  max?: number
  format?: (value: unknown) => string
}

const settings: Setting[] = [
  {
    title: "Theme",
    category: "Appearance",
    description: "Interface color theme",
    detail:
      "Choose the color theme used throughout OpenCode. Custom themes discovered from your config directory appear here alongside the built-in themes.",
    path: ["theme", "name"],
    default: "opencode",
  },
  {
    title: "Color mode",
    category: "Appearance",
    description: "Terminal color preference",
    detail:
      "Choose how OpenCode selects its colors. System follows your terminal preference, while dark and light keep the interface in a fixed mode.",
    path: ["theme", "mode"],
    default: "system",
    values: ["system", "dark", "light"],
  },
  {
    title: "Animations",
    category: "Appearance",
    description: "Interface motion",
    path: ["animations"],
    default: true,
    values: [false, true],
    labels: ["off", "on"],
  },
  {
    title: "Tips",
    category: "Appearance",
    description: "Home screen hints",
    path: ["hints", "tips"],
    default: true,
    values: [false, true],
    labels: ["off", "on"],
  },
  {
    title: "Onboarding",
    category: "Appearance",
    description: "Getting-started guidance",
    path: ["hints", "onboarding"],
    default: true,
    values: [false, true],
    labels: ["off", "on"],
  },
  {
    title: "Sidebar",
    category: "Session",
    description: "Session sidebar visibility",
    path: ["session", "sidebar"],
    default: "auto",
    values: ["hide", "auto"],
  },
  {
    title: "Scrollbar",
    category: "Session",
    description: "Transcript scrollbar",
    path: ["session", "scrollbar"],
    default: false,
    values: [false, true],
    labels: ["off", "on"],
  },
  {
    title: "Thinking",
    category: "Session",
    description: "Model reasoning by default",
    path: ["session", "thinking"],
    default: "hide",
    values: ["hide", "show"],
  },
  {
    title: "Grouping",
    category: "Session",
    description: "Related transcript items",
    path: ["session", "grouping"],
    default: "auto",
    values: ["none", "auto"],
  },
  {
    title: "Layout",
    category: "Diffs",
    description: "Diff presentation",
    path: ["diffs", "view"],
    default: "auto",
    values: ["auto", "split", "unified"],
  },
  {
    title: "Wrapping",
    category: "Diffs",
    description: "Long diff lines",
    path: ["diffs", "wrap"],
    default: "word",
    values: ["none", "word"],
  },
  {
    title: "File tree",
    category: "Diffs",
    description: "Diff file navigation",
    path: ["diffs", "tree"],
    default: true,
    values: [false, true],
    labels: ["off", "on"],
  },
  {
    title: "Single patch",
    category: "Diffs",
    description: "Only the selected patch",
    path: ["diffs", "single"],
    default: false,
    values: [false, true],
    labels: ["off", "on"],
  },
  {
    title: "Scroll speed",
    category: "Input",
    description: "Distance per input tick",
    path: ["scroll", "speed"],
    default: 3,
    step: 0.25,
    min: 0.25,
    max: 10,
    format: (value) => Number(value).toFixed(2),
  },
  {
    title: "Acceleration",
    category: "Input",
    description: "Repeated scrolling",
    path: ["scroll", "acceleration"],
    default: false,
    values: [false, true],
    labels: ["off", "on"],
  },
  {
    title: "Mouse",
    category: "Input",
    description: "Terminal mouse capture",
    path: ["mouse"],
    default: true,
    values: [false, true],
    labels: ["off", "on"],
  },
  {
    title: "Editor context",
    category: "Input",
    description: "Active selection in prompts",
    path: ["prompt", "editor"],
    default: true,
    values: [false, true],
    labels: ["off", "on"],
  },
  {
    title: "Large pastes",
    category: "Input",
    description: "Paste display style",
    path: ["prompt", "paste"],
    default: "compact",
    values: ["compact", "full"],
  },
  {
    title: "Leader timeout",
    category: "Input",
    description: "Wait after leader key",
    path: ["leader", "timeout"],
    default: 2000,
    step: 250,
    min: 250,
    max: 10000,
    format: (value) => `${value} ms`,
  },
  {
    title: "Attention",
    category: "Alerts",
    description: "Alerts when input is needed",
    path: ["attention", "enabled"],
    default: false,
    values: [false, true],
    labels: ["off", "on"],
  },
  {
    title: "Notifications",
    category: "Alerts",
    description: "System notifications",
    path: ["attention", "notifications"],
    default: true,
    values: [false, true],
    labels: ["off", "on"],
  },
  {
    title: "Sounds",
    category: "Alerts",
    description: "Attention sounds",
    path: ["attention", "sound"],
    default: true,
    values: [false, true],
    labels: ["off", "on"],
  },
  {
    title: "Volume",
    category: "Alerts",
    description: "Attention sound level",
    path: ["attention", "volume"],
    default: 0.4,
    step: 0.1,
    min: 0,
    max: 1,
    format: (value) => `${Math.round(Number(value) * 100)}%`,
  },
  {
    title: "Window title",
    category: "Terminal",
    description: "Update terminal title",
    path: ["terminal", "title"],
    default: true,
    values: [false, true],
    labels: ["off", "on"],
  },
]

export function DialogConfig() {
  const config = useConfig()
  const dialog = useDialog()
  const toast = useToast()
  const themeState = useTheme()
  const { theme } = themeState
  const dimensions = useTerminalDimensions()
  const [selected, setSelected] = createSignal(0)
  const [saving, setSaving] = createSignal(false)
  let scroll: ScrollBoxRenderable | undefined
  onMount(() => {
    dialog.setSize("xlarge")
    dialog.setCentered(true)
  })

  const value = (setting: Setting) => {
    const current = setting.path.reduce<unknown>((result, key) => {
      if (!result || typeof result !== "object") return undefined
      return (result as Record<string, unknown>)[key]
    }, config.data)
    if (setting.path.join(".") === "theme.name") return current ?? themeState.selected
    return current ?? setting.default
  }
  const values = (setting: Setting) =>
    setting.path.join(".") === "theme.name"
      ? Object.keys(themeState.all()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      : setting.values
  const compact = (setting: Setting) => setting.path.join(".") === "theme.name" || !setting.values
  const display = (setting: Setting) => setting.format?.(value(setting)) ?? String(value(setting))
  const rows = createMemo(() =>
    settings.map((setting, index) => ({
      setting,
      index,
      heading: index === 0 || settings[index - 1].category !== setting.category,
    })),
  )
  const split = createMemo(() => dimensions().width >= 110)
  const height = createMemo(() => Math.max(8, Math.min(36, dimensions().height - 12)))

  function move(direction: number) {
    const next = (selected() + direction + settings.length) % settings.length
    setSelected(next)
    queueMicrotask(() => {
      if (!scroll) return
      const row =
        next +
        settings.slice(0, next + 1).filter((setting, index) => {
          return index === 0 || settings[index - 1].category !== setting.category
        }).length
      if (row < scroll.scrollTop) scroll.scrollTo(row)
      if (row >= scroll.scrollTop + scroll.viewport.height) scroll.scrollTo(row - scroll.viewport.height + 1)
    })
  }

  async function change(direction: number) {
    if (saving()) return
    const setting = settings[selected()]
    const current = value(setting)
    const choices = values(setting)
    const next = choices
      ? choices[(choices.indexOf(current) + direction + choices.length) % choices.length]
      : Math.min(setting.max!, Math.max(setting.min!, Number(current) + direction * setting.step!))
    if (next === current) return
    setSaving(true)
    await config
      .update((draft) => {
        const parent = setting.path.slice(0, -1).reduce<Record<string, unknown>>((result, key) => {
          if (!result[key] || typeof result[key] !== "object") result[key] = {}
          return result[key] as Record<string, unknown>
        }, draft)
        parent[setting.path.at(-1)!] = next
      })
      .catch(toast.error)
      .finally(() => setSaving(false))
  }

  useBindings(() => ({
    bindings: [
      {
        key: "up",
        desc: "Previous setting",
        group: "Settings",
        cmd: () => move(-1),
      },
      {
        key: "down",
        desc: "Next setting",
        group: "Settings",
        cmd: () => move(1),
      },
      { key: "left", desc: "Previous value", group: "Settings", cmd: () => void change(-1) },
      { key: "right", desc: "Next value", group: "Settings", cmd: () => void change(1) },
      { key: "return", desc: "Next value", group: "Settings", cmd: () => void change(1) },
    ],
  }))

  return (
    <box flexDirection="row" height={height() + 1}>
      <box width={split() ? "54%" : "100%"} paddingLeft={4} paddingRight={split() ? 3 : 4} paddingBottom={1}>
        <text fg={theme.text} attributes={TextAttributes.BOLD} paddingBottom={1}>
          Settings
        </text>
        <scrollbox
          ref={(element: ScrollBoxRenderable) => (scroll = element)}
          flexGrow={1}
          scrollbarOptions={{ visible: false }}
        >
          <For each={rows()}>
            {(row) => (
              <>
                <Show when={row.heading}>
                  <box paddingTop={row.index === 0 ? 0 : 1}>
                    <text fg={theme.primary} attributes={TextAttributes.BOLD}>
                      {row.setting.category}
                    </text>
                  </box>
                </Show>
                <box flexDirection="row" height={1}>
                  <text
                    width={25}
                    fg={row.index === selected() ? theme.text : theme.textMuted}
                    attributes={row.index === selected() ? TextAttributes.BOLD : undefined}
                  >
                    {row.setting.title}
                  </text>
                  <box flexGrow={1} flexDirection="row" justifyContent="flex-end">
                    <Show
                      when={!compact(row.setting) && values(row.setting)}
                      fallback={
                        <box flexDirection="row">
                          <Show when={row.index === selected()}>
                            <text fg={theme.textMuted}>‹ </text>
                          </Show>
                          <text
                            fg={row.index === selected() ? theme.primary : theme.textMuted}
                            attributes={row.index === selected() ? TextAttributes.BOLD : undefined}
                          >
                            {display(row.setting)}
                          </text>
                          <Show when={row.index === selected()}>
                            <text fg={theme.textMuted}> ›</text>
                          </Show>
                        </box>
                      }
                    >
                      <box flexDirection="row" gap={2}>
                        <For each={values(row.setting)!}>
                          {(option, optionIndex) => {
                            const active = () => value(row.setting) === option
                            return (
                              <text
                                fg={
                                  active() ? (row.index === selected() ? theme.primary : theme.text) : theme.textMuted
                                }
                                attributes={active() ? TextAttributes.BOLD : undefined}
                              >
                                {row.setting.labels?.[optionIndex()] ?? String(option)}
                              </text>
                            )
                          }}
                        </For>
                      </box>
                    </Show>
                  </box>
                </box>
              </>
            )}
          </For>
        </scrollbox>
      </box>
      <Show when={split()}>
        <box
          position="relative"
          top={-1}
          width="46%"
          height={height() + 2}
          paddingTop={1}
          paddingLeft={2}
          paddingRight={2}
          backgroundColor={theme.backgroundElement}
        >
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme.primary} attributes={TextAttributes.BOLD}>
              {settings[selected()].title}
            </text>
            <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
              esc
            </text>
          </box>
          <box paddingTop={1}>
            <text fg={theme.text} wrapMode="word">
              {settings[selected()].detail ?? settings[selected()].description}
            </text>
          </box>
        </box>
      </Show>
    </box>
  )
}
