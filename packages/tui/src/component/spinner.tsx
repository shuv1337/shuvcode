import { createMemo, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import type { JSX } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import "opentui-spinner/solid"
import {
  clampInterval,
  DEFAULT_SPINNER_INTERVAL_MS,
  DEFAULT_SPINNER_KEY,
  spinnerFrames,
} from "../util/spinners"

export const SPINNER_FRAMES = spinnerFrames(DEFAULT_SPINNER_KEY)

export function Spinner(props: { children?: JSX.Element; color?: RGBA }) {
  const { theme } = useTheme()
  const kv = useKV()
  const color = () => props.color ?? theme.textMuted
  const frames = createMemo(() => spinnerFrames(kv.get("spinner_style", DEFAULT_SPINNER_KEY)))
  const interval = createMemo(() => clampInterval(kv.get("spinner_interval", DEFAULT_SPINNER_INTERVAL_MS)))
  return (
    <Show when={kv.get("animations_enabled", true)} fallback={<text fg={color()}>⋯ {props.children}</text>}>
      <box flexDirection="row" gap={1}>
        <spinner frames={frames()} interval={interval()} color={color()} />
        <Show when={props.children}>
          <text fg={color()}>{props.children}</text>
        </Show>
      </box>
    </Show>
  )
}
