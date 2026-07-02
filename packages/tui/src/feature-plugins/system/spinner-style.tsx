import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal, For, onCleanup, onMount } from "solid-js"
import type { BuiltinTuiPlugin } from "../builtins"
import {
  clampInterval,
  DEFAULT_SPINNER_INTERVAL_MS,
  DEFAULT_SPINNER_KEY,
  getSpinnerDisplayName,
  getSpinnerKeys,
  getSpinnerPreview,
  SPINNER_INTERVAL_PRESETS,
  spinnerFrames,
} from "../../util/spinners"

const id = "internal:spinner-style"
const styleKey = "spinner_style"
const intervalKey = "spinner_interval"

function SpinnerStyleDialog(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const keys = getSpinnerKeys()
  const current = () => props.api.kv.get(styleKey, DEFAULT_SPINNER_KEY)
  const [preview, setPreview] = createSignal(0)

  onMount(() => {
    const timer = setInterval(() => setPreview((value) => value + 1), props.api.kv.get(intervalKey, DEFAULT_SPINNER_INTERVAL_MS))
    onCleanup(() => clearInterval(timer))
  })

  return (
    <box flexDirection="column" gap={1} padding={1}>
      <text fg={theme().text}>Spinner style</text>
      <For each={keys}>
        {(key) => {
          const frames = spinnerFrames(key)
          const frame = createMemo(() => frames[preview() % frames.length])
          return (
            <box
              flexDirection="row"
              gap={2}
              onMouseDown={() => {
                props.api.kv.set(styleKey, key)
                props.api.ui.dialog.clear()
              }}
            >
              <text fg={key === current() ? theme().primary : theme().textMuted}>{getSpinnerDisplayName(key)}</text>
              <text fg={theme().text}>{frame()}</text>
              <text fg={theme().textMuted}>{getSpinnerPreview(key)}</text>
            </box>
          )
        }}
      </For>
    </box>
  )
}

function SpinnerIntervalDialog(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const current = () => props.api.kv.get(intervalKey, DEFAULT_SPINNER_INTERVAL_MS)

  return (
    <box flexDirection="column" gap={1} padding={1}>
      <text fg={theme().text}>Spinner speed</text>
      <For each={[...SPINNER_INTERVAL_PRESETS]}>
        {(preset) => (
          <box
            flexDirection="row"
            gap={2}
            onMouseDown={() => {
              props.api.kv.set(intervalKey, clampInterval(preset.value))
              props.api.ui.dialog.clear()
            }}
          >
            <text fg={preset.value === current() ? theme().primary : theme().textMuted}>{preset.label}</text>
          </box>
        )}
      </For>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.keymap.registerLayer({
    commands: [
      {
        name: "spinner.style",
        title: "Change spinner style",
        category: "Appearance",
        namespace: "palette",
        run() {
          api.ui.dialog.replace(() => <SpinnerStyleDialog api={api} />)
        },
      },
      {
        name: "spinner.interval",
        title: "Change spinner speed",
        category: "Appearance",
        namespace: "palette",
        run() {
          api.ui.dialog.replace(() => <SpinnerIntervalDialog api={api} />)
        },
      },
    ],
  })
}

const plugin: BuiltinTuiPlugin = { id, tui }

export default plugin