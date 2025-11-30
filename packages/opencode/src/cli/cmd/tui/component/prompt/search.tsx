import { BoxRenderable, TextareaRenderable, type KeyBinding } from "@opentui/core"
import { createEffect, createMemo, createSignal, type JSX, onMount, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { EmptyBorder } from "@tui/component/border"
import { createStore } from "solid-js/store"
import { useKeybind } from "@tui/context/keybind"
import { Locale } from "@/util/locale"
import { useLocal } from "@tui/context/local"
import { RGBA } from "@opentui/core"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useExit } from "../../context/exit"

export type SearchInputProps = {
  disabled?: boolean
  onSubmit?: (query: string) => void
  onExit?: () => void
  onInput?: (query: string) => void
  onNext?: () => void
  onPrevious?: () => void
  matchInfo?: { current: number; total: number }
  sessionID?: string
  ref?: (ref: SearchInputRef) => void
  placeholder?: string
}

export type SearchInputRef = {
  focused: boolean
  reset(): void
  blur(): void
  focus(): void
  getValue(): string
}

export function SearchInput(props: SearchInputProps) {
  let input: TextareaRenderable
  let anchor: BoxRenderable

  const exit = useExit()
  const keybind = useKeybind()
  const local = useLocal()
  const sdk = useSDK()
  const sync = useSync()
  const { theme } = useTheme()

  const highlight = createMemo(() => {
    const agent = local.agent.current()
    if (agent?.color) return RGBA.fromHex(agent.color)
    const agents = local.agent.list()
    const index = agents.findIndex((x) => x.name === "search")
    const colors = [theme.secondary, theme.accent, theme.success, theme.warning, theme.primary, theme.error]
    if (index === -1) return colors[0]
    return colors[index % colors.length]
  })

  const textareaKeybindings = createMemo(() => {
    const submitBindings = keybind.all.input_submit || []
    return [
      { name: "return", action: "submit" },
      ...submitBindings.map((binding) => ({
        name: binding.name,
        ctrl: binding.ctrl || undefined,
        meta: binding.meta || undefined,
        shift: binding.shift || undefined,
        action: "submit" as const,
      })),
    ] satisfies KeyBinding[]
  })

  const [store, setStore] = createStore<{
    input: string
  }>({
    input: "",
  })

  createEffect(() => {
    if (props.disabled) input.cursorColor = theme.backgroundElement
    if (!props.disabled) input.cursorColor = theme.primary
  })

  props.ref?.({
    get focused() {
      return input.focused
    },
    focus() {
      input.focus()
    },
    blur() {
      input.blur()
    },
    reset() {
      input.clear()
      setStore("input", "")
    },
    getValue() {
      return store.input
    },
  })

  function submit() {
    if (props.disabled) return
    if (!store.input) return
    props.onSubmit?.(store.input)
    input.clear()
    setStore("input", "")
  }

  onMount(() => {
    input.focus()
  })

  return (
    <>
      <box ref={(r) => (anchor = r)}>
        <box
          border={["left"]}
          borderColor={highlight()}
          customBorderChars={{
            ...EmptyBorder,
            vertical: "┃",
            bottomLeft: "╹",
          }}
        >
          <box
            paddingLeft={2}
            paddingRight={1}
            paddingTop={1}
            flexShrink={0}
            backgroundColor={theme.backgroundElement}
            flexGrow={1}
          >
            <textarea
              placeholder={props.placeholder}
              textColor={theme.text}
              focusedTextColor={theme.text}
              minHeight={1}
              maxHeight={6}
              onContentChange={() => {
                const text = input.plainText.trim()
                setStore("input", text)
                props.onInput?.(text)
              }}
              keyBindings={textareaKeybindings()}
              onKeyDown={async (e) => {
                if (props.disabled) {
                  e.preventDefault()
                  return
                }

                if (e.name === "down") {
                  e.preventDefault()
                  props.onNext?.()
                  return
                }

                if (e.name === "up") {
                  e.preventDefault()
                  props.onPrevious?.()
                  return
                }

                if (e.name === "escape" || (e.ctrl && e.name === "f")) {
                  props.onExit?.()
                  e.preventDefault()
                  return
                }

                if (keybind.match("app_exit", e)) {
                  await exit()
                  return
                }
              }}
              onSubmit={submit}
              ref={(r: TextareaRenderable) => (input = r)}
              focusedBackgroundColor={theme.backgroundElement}
              cursorColor={highlight()}
            />
            <box flexDirection="row" flexShrink={0} paddingTop={1} gap={1}>
              <text fg={highlight()}>Search</text>
              <Show
                when={props.matchInfo && props.matchInfo.total > 0}
                fallback={<text fg={theme.textMuted}>{store.input ? "No matches" : "Go through session history"}</text>}
              >
                <text fg={theme.text}>
                  {props.matchInfo!.current + 1} of {props.matchInfo!.total}
                </text>
              </Show>
            </box>
          </box>
        </box>
        <box
          height={1}
          border={["left"]}
          borderColor={highlight()}
          customBorderChars={{
            ...EmptyBorder,
            vertical: "╹",
          }}
        >
          <box
            height={1}
            border={["bottom"]}
            borderColor={theme.backgroundElement}
            customBorderChars={
              theme.background.a != 0
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
        <box flexDirection="row" justifyContent="flex-end">
          <box gap={2} flexDirection="row">
            <text fg={theme.text}>
              ↑/↓ <span style={{ fg: theme.textMuted }}>navigate</span>
            </text>
            <text fg={theme.text}>
              esc <span style={{ fg: theme.textMuted }}>exit</span>
            </text>
          </box>
        </box>
      </box>
    </>
  )
}
