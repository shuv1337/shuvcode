import type { KeymapCommand, KeymapLayer } from "@opencode-ai/plugin/v2/tui/context"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { stringifyKeyStroke } from "@opentui/keymap"
import {
  registerBackspacePopsPendingSequence,
  registerBaseLayoutFallback,
  registerCommaBindings,
  registerEscapeClearsPendingSequence,
  registerManagedTextareaLayer,
  registerTimedLeader,
} from "@opentui/keymap/addons/opentui"
import { formatCommandBindings, formatKeySequence } from "@opentui/keymap/extras"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { KeymapProvider, useBindings, useKeymapSelector } from "@opentui/keymap/solid"
import { useRenderer } from "@opentui/solid"
import { createContext, onCleanup, useContext, type Accessor, type ParentProps } from "solid-js"
import { useConfig } from "../config"
import { TuiKeybind } from "../config/keybind"

declare module "@opentui/keymap" {
  interface Command {
    opencode?: KeymapCommand
    slash?: {
      name: string
      aliases?: string[]
      arguments?: true
    }
  }
}

const MODE = { key: "opencode.mode", base: "base" } as const

type OpenTuiKeymap = Parameters<typeof KeymapProvider>[0]["keymap"]
type Mode = ReturnType<typeof createMode>

const Context = createContext<{
  readonly keymap: OpenTuiKeymap
  readonly mode: Mode
  readonly dispatch: (id: string, input?: string) => void
  readonly input: (id: string) => string | undefined
}>()

function Provider(props: ParentProps) {
  const renderer = useRenderer()
  const config = useConfig()
  const keymap = createDefaultOpenTuiKeymap(renderer)
  const mode = createMode(keymap)
  let invocation: { readonly id: string; readonly input?: string } | undefined
  const dispatch = (id: string, input?: string) => {
    const previous = invocation
    invocation = { id, input }
    try {
      keymap.dispatchCommand(id)
    } finally {
      invocation = previous
    }
  }
  const dispose = [
    registerCommaBindings(keymap),
    keymap.appendBindingExpander((context) => {
      const key = Object.entries({ enter: "return", esc: "escape", pgdown: "pagedown", pgup: "pageup" }).reduce(
        (result, [alias, value]) =>
          result.replace(new RegExp(`(^|[+,\\s>])${alias}(?=$|[+,\\s<])`, "gi"), `$1${value}`),
        context.input,
      )
      if (key === context.input) return
      return [{ key, displays: context.displays }]
    }),
    registerBaseLayoutFallback(keymap),
    registerEscapeClearsPendingSequence(keymap),
    registerBackspacePopsPendingSequence(keymap),
    registerManagedTextareaLayer(keymap, renderer, {
      enabled: () => {
        const editor = renderer.currentFocusedEditor
        return editor instanceof TextareaRenderable && !(editor instanceof InputRenderable)
      },
      bindings: [
        "input.move.left",
        "input.move.right",
        "input.move.up",
        "input.move.down",
        "input.select.left",
        "input.select.right",
        "input.select.up",
        "input.select.down",
        "input.line.home",
        "input.line.end",
        "input.select.line.home",
        "input.select.line.end",
        "input.visual.line.home",
        "input.visual.line.end",
        "input.select.visual.line.home",
        "input.select.visual.line.end",
        "input.buffer.home",
        "input.buffer.end",
        "input.select.buffer.home",
        "input.select.buffer.end",
        "input.delete.line",
        "input.delete.to.line.end",
        "input.delete.to.line.start",
        "input.backspace",
        "input.delete",
        "input.newline",
        "input.undo",
        "input.redo",
        "input.word.forward",
        "input.word.backward",
        "input.select.word.forward",
        "input.select.word.backward",
        "input.delete.word.forward",
        "input.delete.word.backward",
        "input.select.all",
        "input.submit",
      ].flatMap((command) => config.data.keybinds.get(command)),
    }),
  ]
  const leader = config.data.keybinds.get("leader")?.[0]?.key
  if (leader) {
    dispose.push(
      registerTimedLeader(keymap, {
        trigger: leader,
        name: "leader",
        timeoutMs: config.data.leader.timeout,
      }),
    )
  }
  onCleanup(() => {
    dispose.reverse().forEach((item) => item())
    mode.dispose()
  })
  return (
    <KeymapProvider keymap={keymap}>
      <Context.Provider
        value={{ keymap, mode, dispatch, input: (id) => (invocation?.id === id ? invocation.input : undefined) }}
      >
        {props.children}
      </Context.Provider>
    </KeymapProvider>
  )
}

export type { KeymapCommand, KeymapLayer } from "@opencode-ai/plugin/v2/tui/context"

export interface Keymap {
  /** Dispatches a reachable command by ID. */
  dispatch(id: string, input?: string): void
  /** Controls mutually exclusive OpenCode input modes. */
  readonly mode: {
    /** Returns the active mode. */
    current(): string
    /** Pushes a mode until the returned cleanup is called. */
    push(mode: string): () => void
  }
}

function use(): Keymap {
  const value = useValue()
  return {
    dispatch(id, input) {
      value.dispatch(id, input)
    },
    mode: value.mode,
  }
}

function createLayer(input: () => KeymapLayer) {
  const value = useValue()
  const config = useConfig()
  useBindings(() => {
    const layer = input()
    const { commands, bindings, mode, ...options } = layer
    const grouped = (commands ?? []).reduce(
      (result, command) => {
        if (command.id !== undefined) {
          if (!command.id) throw new Error("Keymap command IDs cannot be empty")
          if (typeof command.bind === "string" && !command.bind)
            throw new Error("Keymap command bindings cannot be empty")
          result.named.push({ ...command, id: command.id })
          return result
        }
        if (command.palette) throw new Error("Palette commands require an ID")
        if (command.slash) throw new Error("Slash commands require an ID")
        if (typeof command.bind !== "string") throw new Error("Inline keymap commands require bind")
        if (!command.bind) throw new Error("Keymap command bindings cannot be empty")
        result.inline.push({ ...command, id: undefined, bind: command.bind })
        return result
      },
      {
        named: [] as Array<KeymapCommand & { readonly id: string }>,
        inline: [] as Array<KeymapCommand & { readonly id?: undefined; readonly bind: string }>,
      },
    )
    return {
      ...options,
      ...(mode === "global" ? {} : { mode: mode ?? MODE.base }),
      commands: grouped.named.map((command) => {
        const { id, description, group, palette, bind, run, ...definition } = command
        return {
          ...definition,
          name: id,
          opencode: command,
          run: () => run(value.input(id)),
          ...(description === undefined ? {} : { desc: description }),
          ...(group === undefined ? {} : { category: group }),
          ...(palette === undefined ? {} : { namespace: "palette" }),
        }
      }),
      bindings: [
        ...grouped.inline.map((command) => ({
          key: command.bind,
          cmd: () => {
            if (command.enabled === false) return false
            if (typeof command.enabled === "function" && !command.enabled()) return false
            return command.run()
          },
          ...(command.title === undefined && command.description === undefined
            ? {}
            : { desc: command.title ?? command.description }),
          ...(command.group === undefined ? {} : { group: command.group }),
        })),
        ...grouped.named.flatMap((command) => {
          if (command.bind === false) return []
          const configured = config.data.keybinds.get(command.id)
          if (configured.length) return configured
          if (typeof command.bind !== "string") return []
          return [{ key: command.bind, cmd: command.id }]
        }),
        ...(bindings ?? []).flatMap((id) => config.data.keybinds.get(id)),
      ],
    }
  })
}

function useShortcuts() {
  useValue()
  const config = useConfig()
  const shortcuts = useKeymapSelector((keymap) => {
    const commands = keymap.getCommands({ visibility: "registered" }).map((command) => command.name)
    const bindings = keymap.getCommandBindings({ visibility: "registered", commands })
    return new Map(
      commands.map((id) => [
        id,
        {
          first: formatKeySequence(bindings.get(id)?.[0]?.sequence, formatOptions(config.data)),
          all: formatCommandBindings(bindings.get(id) ?? [], formatOptions(config.data)),
        },
      ]),
    )
  })
  return {
    get(id: string) {
      return shortcuts().get(id)?.first
    },
    all(id: string) {
      return shortcuts().get(id)?.all
    },
  }
}

function useCommands(): Accessor<readonly KeymapCommand[]> {
  const value = useValue()
  return useKeymapSelector((keymap) =>
    keymap
      .getCommandEntries({
        visibility: "reachable",
      })
      .map((entry) => {
        const command = entry.command.opencode ?? {
          id: entry.command.name,
          title: typeof entry.command.title === "string" ? entry.command.title : undefined,
          description: typeof entry.command.desc === "string" ? entry.command.desc : undefined,
          group: typeof entry.command.category === "string" ? entry.command.category : undefined,
          enabled:
            typeof entry.command.enabled === "boolean" || typeof entry.command.enabled === "function"
              ? (entry.command.enabled as boolean | (() => boolean))
              : undefined,
          palette: entry.command.namespace === "palette" ? true : undefined,
          slash: entry.command.slash,
          suggested:
            typeof entry.command.suggested === "boolean" || typeof entry.command.suggested === "function"
              ? (entry.command.suggested as boolean | (() => boolean))
              : undefined,
        }
        return {
          ...command,
          run: (input?: string) => {
            value.dispatch(entry.command.name, input)
          },
        }
      }),
  )
}

function usePendingSequence() {
  useValue()
  return useKeymapSelector((keymap) => keymap.getPendingSequence())
}

function useActiveKeys() {
  useValue()
  return useKeymapSelector((keymap) => keymap.getActiveKeys({ includeMetadata: true }))
}

function useValue() {
  const value = useContext(Context)
  if (!value) throw new Error("Keymap.Provider is missing")
  return value
}

export const Keymap = {
  Provider,
  use,
  createLayer,
  useShortcuts,
  useCommands,
  usePendingSequence,
  useActiveKeys,
} as const

function createMode(keymap: OpenTuiKeymap) {
  keymap.setData(MODE.key, MODE.base)
  const unregister = keymap.registerLayerFields({
    mode(value, context) {
      context.require(MODE.key, value)
    },
  })
  const stack: { readonly id: symbol; readonly mode: string }[] = []
  let disposed = false

  const update = () => keymap.setData(MODE.key, stack.at(-1)?.mode ?? MODE.base)

  return {
    current() {
      return stack.at(-1)?.mode ?? MODE.base
    },
    push(mode: string) {
      if (disposed) return () => {}
      const id = Symbol(mode)
      stack.push({ id, mode })
      update()
      return () => {
        const index = stack.findIndex((item) => item.id === id)
        if (index < 0) return
        stack.splice(index, 1)
        update()
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      stack.length = 0
      unregister()
      keymap.setData(MODE.key, undefined)
    },
  }
}

function formatOptions(config: ReturnType<typeof useConfig>["data"]) {
  const leader = config.keybinds.get("leader")?.[0]?.key
  return {
    tokenDisplay: {
      leader: leader ? (typeof leader === "string" ? leader : stringifyKeyStroke(leader)) : TuiKeybind.LeaderDefault,
    },
    keyNameAliases: {
      up: "↑",
      down: "↓",
      left: "←",
      right: "→",
      pageup: "pgup",
      pagedown: "pgdn",
      delete: "del",
    },
    modifierAliases: {
      meta: "alt",
    },
  } as const
}
