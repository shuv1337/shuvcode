export * as Config from "."
export * from "./schema"

import { createBindingLookup } from "@opentui/keymap/extras"
import { createContext, createMemo, onCleanup, type JSX, useContext } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { safeWatch } from "../util/watch"
import path from "path"
import { TuiKeybind } from "./keybind"
import type { AttentionSoundPaths, Info } from "./schema"

export interface Interface {
  readonly path?: string
  readonly get: () => Promise<Info>
  readonly update: (update: (draft: any) => void) => Promise<Info>
}

export type Resolved = Omit<Info, "attention" | "cursor" | "keybinds" | "leader" | "mouse" | "session" | "tabs"> & {
  attention: {
    notifications: boolean
    sound: boolean
    volume: number
    sound_pack: string
    sounds: AttentionSoundPaths
  }
  keybinds: TuiKeybind.BindingLookupView
  leader: { timeout: number }
  mouse: boolean
  cursor: {
    style: "block" | "underline" | "line" | "default"
    blinking: boolean
  }
  session: Omit<NonNullable<Info["session"]>, "new_location" | "permissions" | "tps"> & {
    new_location: "launch" | "inherit"
    permissions: "prompt" | "autoaccept"
    tps: boolean
  }
  tabs: {
    mode: "auto" | "on" | "off"
    enabled: boolean
    scope: "global" | "cwd"
    layout: "horizontal" | "vertical"
    indicators: "status" | "numbers"
  }
}

export function resolve(
  input: Info,
  options: { terminalSuspend: boolean; environment?: Readonly<Record<string, string | undefined>> },
): Resolved {
  const tabsMode = input.tabs?.mode ?? (input.tabs?.enabled === undefined ? "auto" : input.tabs.enabled ? "on" : "off")
  const keybinds: TuiKeybind.KeybindOverrides = { ...input.keybinds }
  if (!options.terminalSuspend) {
    keybinds["terminal.suspend"] = "none"
    if (keybinds["input.undo"] === undefined) {
      const inputUndo = TuiKeybind.defaultValue("input.undo")
      keybinds["input.undo"] = ["ctrl+z", ...(typeof inputUndo === "string" ? inputUndo.split(",") : [])]
        .filter((value, index, values) => values.indexOf(value) === index)
        .join(",")
    }
  }

  return {
    ...input,
    attention: {
      notifications: input.attention?.notifications ?? false,
      sound: input.attention?.sound ?? false,
      volume: input.attention?.volume ?? 0.4,
      sound_pack: input.attention?.sound_pack ?? "opencode.default",
      sounds: input.attention?.sounds ?? {},
    },
    keybinds: createBindingLookup(TuiKeybind.toBindingConfig(TuiKeybind.parse(keybinds)), {
      bindingDefaults: TuiKeybind.bindingDefaults(),
    }),
    leader: { timeout: input.leader?.timeout ?? 2000 },
    mouse: input.mouse ?? true,
    cursor: {
      style: input.cursor?.style ?? "block",
      blinking: input.cursor?.blinking ?? true,
    },
    session: {
      ...input.session,
      new_location: input.session?.new_location ?? "launch",
      permissions: input.session?.permissions ?? "prompt",
      tps: input.session?.tps ?? true,
    },
    tabs: {
      ...input.tabs,
      mode: tabsMode,
      enabled: tabsMode === "on" || (tabsMode === "auto" && (options.environment ?? process.env).HERDR_ENV !== "1"),
      scope: input.tabs?.scope ?? "cwd",
      layout: input.tabs?.layout ?? "horizontal",
      indicators: input.tabs?.indicators ?? "status",
    },
  }
}

const ConfigContext = createContext<{
  data: Resolved
  path?: string
  update: Interface["update"]
}>()

export function ConfigProvider(props: {
  config: Resolved
  service?: Interface
  options?: { terminalSuspend: boolean; environment?: Readonly<Record<string, string | undefined>> }
  children: JSX.Element
}) {
  const [config, setConfig] = createStore(props.config)
  const host = props.service
  const apply = (info: Info) => setConfig(reconcile(resolve(info, props.options ?? { terminalSuspend: true })))
  const update = async (update: (draft: any) => void) => {
    if (!host) throw new Error("Config updates are not available")
    const info = await host.update(update)
    apply(info)
    return info
  }
  let reload = Promise.resolve()
  const watcher = host?.path
    ? safeWatch(path.dirname(host.path), () => {
        reload = reload
          .then(() => host.get())
          .then(apply)
          .catch(() => {})
      })
    : undefined
  onCleanup(() => watcher?.close())
  return (
    <ConfigContext.Provider value={{ data: config, path: host?.path, update }}>{props.children}</ConfigContext.Provider>
  )
}

export function useConfig() {
  const value = useContext(ConfigContext)
  if (!value) throw new Error("ConfigProvider is missing")
  return value
}

/**
 * The configured textarea cursor, replaced only when the cursor config changes. A fresh object on every render effect
 * would restyle the textarea whenever an unrelated prop changes, discarding a style a plugin set on it.
 */
export function useCursorStyle() {
  const config = useConfig()
  return createMemo(() => ({ style: config.data.cursor.style, blinking: config.data.cursor.blinking }))
}

/** Reactive accessor for the temporary "new-designs" experiment. */
export function useNewDesigns() {
  const config = useConfig()
  return () => config.data.experimental?.["new-designs"] === true
}

/** Reactive accessor for the temporary "client-mcp" experiment. */
export function useClientMcpExperiment() {
  const config = useConfig()
  return () => config.data.experimental?.["client-mcp"] === true
}
