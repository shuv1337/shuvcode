import { BoxRenderable, TextareaRenderable, MouseEvent, PasteEvent, t, dim, fg, type KeyBinding } from "@opentui/core"
import { createEffect, createMemo, type JSX, onMount, createSignal, onCleanup, Show, Switch, Match, batch } from "solid-js"
import "opentui-spinner/solid"
import { useLocal } from "@tui/context/local"
import { useTheme } from "@tui/context/theme"
import { EmptyBorder } from "@tui/component/border"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { Identifier } from "@/id/id"
import { createStore, produce } from "solid-js/store"
import { useKeybind } from "@tui/context/keybind"
import { Keybind } from "@/util/keybind"
import { usePromptHistory, type PromptInfo } from "./history"
import { type AutocompleteRef, Autocomplete } from "./autocomplete"
import { useCommandDialog } from "../dialog-command"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { Editor } from "@tui/util/editor"
import { useExit } from "../../context/exit"
import { Clipboard } from "../../util/clipboard"
import { parseUriList } from "../../util/uri"
import type { FilePart } from "@opencode-ai/sdk/v2"
import { TuiEvent } from "../../event"
import { Ide } from "@/ide"
import { iife } from "@/util/iife"
import { Locale } from "@/util/locale"
import { createColors, createFrames } from "../../ui/spinner.ts"
import { useDialog } from "@tui/ui/dialog"
import { DialogProvider as DialogProviderConnect } from "../dialog-provider"
import { DialogAlert } from "../../ui/dialog-alert"
import { useToast } from "../../ui/toast"
import { useKV } from "../../context/kv"

// Regex to match optional whitespace followed by #L<start>[-<end>] line range syntax after a file reference
// Only matches when followed by a space (confirming the line range is complete)
const LINE_RANGE_SUFFIX_REGEX = /^(\s*)#L(\d+)(?:-(\d+))?\s/

export type PromptProps = {
  sessionID?: string
  disabled?: boolean
  onSubmit?: () => void
  onSearchToggle?: () => void
  ref?: (ref: PromptRef) => void
  hint?: JSX.Element
  showPlaceholder?: boolean
}

export type PromptRef = {
  focused: boolean
  current: PromptInfo
  set(prompt: PromptInfo): void
  reset(): void
  blur(): void
  focus(): void
}

const PLACEHOLDERS = ["Fix a TODO in the codebase", "What is the tech stack of this project?", "Fix broken tests"]

const TEXTAREA_ACTIONS = [
  "submit",
  "newline",
  "move-left",
  "move-right",
  "move-up",
  "move-down",
  "select-left",
  "select-right",
  "select-up",
  "select-down",
  "line-home",
  "line-end",
  "select-line-home",
  "select-line-end",
  "visual-line-home",
  "visual-line-end",
  "select-visual-line-home",
  "select-visual-line-end",
  "buffer-home",
  "buffer-end",
  "select-buffer-home",
  "select-buffer-end",
  "delete-line",
  "delete-to-line-end",
  "delete-to-line-start",
  "backspace",
  "delete",
  "undo",
  "redo",
  "word-forward",
  "word-backward",
  "select-word-forward",
  "select-word-backward",
  "delete-word-forward",
  "delete-word-backward",
] as const

function mapTextareaKeybindings(
  keybinds: Record<string, Keybind.Info[]>,
  action: (typeof TEXTAREA_ACTIONS)[number],
): KeyBinding[] {
  const configKey = `input_${action.replace(/-/g, "_")}`
  const bindings = keybinds[configKey]
  if (!bindings) return []
  return bindings.map((binding) => ({
    name: binding.name,
    ctrl: binding.ctrl || undefined,
    meta: binding.meta || undefined,
    shift: binding.shift || undefined,
    super: binding.super || undefined,
    action,
  }))
}

export function Prompt(props: PromptProps) {
  let input: TextareaRenderable
  let anchor: BoxRenderable
  let autocomplete: AutocompleteRef

  const keybind = useKeybind()
  const local = useLocal()
  const sdk = useSDK()
  const route = useRoute()
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()
  const status = createMemo(() => sync.data.session_status[props.sessionID ?? ""] ?? { type: "idle" })
  const history = usePromptHistory()
  const command = useCommandDialog()
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const tall = createMemo(() => dimensions().height > 40)
  const wide = createMemo(() => dimensions().width > 120)
  const { theme, syntax } = useTheme()
  const kv = useKV()

  function promptModelWarning() {
    toast.show({
      variant: "warning",
      message: "Connect a provider to send prompts",
      duration: 3000,
    })
    if (sync.data.provider.length === 0) {
      dialog.replace(() => <DialogProviderConnect />)
    }
  }

  const textareaKeybindings = createMemo(() => {
    const keybinds = keybind.all

    return [
      { name: "return", action: "submit" },
      { name: "return", meta: true, action: "newline" },
      ...TEXTAREA_ACTIONS.flatMap((action) => mapTextareaKeybindings(keybinds, action)),
    ] satisfies KeyBinding[]
  })

  const fileStyleId = syntax().getStyleId("extmark.file")!
  const agentStyleId = syntax().getStyleId("extmark.agent")!
  const pasteStyleId = syntax().getStyleId("extmark.paste")!
  let promptPartTypeId: number

  const lastUserMessage = createMemo(() => {
    if (!props.sessionID) return undefined
    const messages = sync.data.message[props.sessionID]
    if (!messages) return undefined
    return messages.findLast((m) => m.role === "user")
  })

  const [store, setStore] = createStore<{
    prompt: PromptInfo
    mode: "normal" | "shell"
    extmarkToPartIndex: Map<number, number>
    interrupt: number
    placeholder: number
  }>({
    placeholder: Math.floor(Math.random() * PLACEHOLDERS.length),
    prompt: {
      input: "",
      parts: [],
    },
    mode: "normal",
    extmarkToPartIndex: new Map(),
    interrupt: 0,
  })

  // Initialize agent/model/variant from last user message when session changes
  let syncedSessionID: string | undefined
  createEffect(() => {
    const sessionID = props.sessionID
    const msg = lastUserMessage()

    if (sessionID !== syncedSessionID) {
      if (!sessionID || !msg) return

      syncedSessionID = sessionID

      batch(() => {
        if (msg.agent) local.agent.set(msg.agent)
        if (msg.model) local.model.set(msg.model)
        if (msg.variant) local.model.variant.set(msg.variant)
      })
    }
  })

  command.register(() => {
    return [
      {
        title: "Clear prompt",
        value: "prompt.clear",
        category: "Prompt",
        disabled: true,
        onSelect: (dialog) => {
          input.extmarks.clear()
          input.clear()
          dialog.clear()
        },
      },
      {
        title: "Submit prompt",
        value: "prompt.submit",
        disabled: true,
        keybind: "input_submit",
        category: "Prompt",
        onSelect: (dialog) => {
          if (!input.focused) return
          submit()
          dialog.clear()
        },
      },
      {
        title: "Paste",
        value: "prompt.paste",
        disabled: true,
        keybind: "input_paste",
        category: "Prompt",
        onSelect: async () => {
          const content = await Clipboard.read()
          if (content?.mime.startsWith("image/")) {
            await pasteImage({
              filename: "clipboard",
              mime: content.mime,
              content: content.data,
            })
          }
        },
      },
      {
        title: "Interrupt session",
        value: "session.interrupt",
        keybind: "session_interrupt",
        disabled: status().type === "idle",
        category: "Session",
        onSelect: (dialog) => {
          if (autocomplete.visible) return
          if (!input.focused) return
          // TODO: this should be its own command
          if (store.mode === "shell") {
            setStore("mode", "normal")
            return
          }
          if (!props.sessionID) return

          setStore("interrupt", store.interrupt + 1)

          setTimeout(() => {
            setStore("interrupt", 0)
          }, 5000)

          if (store.interrupt >= 2) {
            sdk.client.session.abort({
              sessionID: props.sessionID,
            })
            setStore("interrupt", 0)
          }
          dialog.clear()
        },
      },
      {
        title: "Open editor",
        category: "Session",
        keybind: "editor_open",
        value: "prompt.editor",
        onSelect: async (dialog, trigger) => {
          dialog.clear()

          // replace summarized text parts with the actual text
          const text = store.prompt.parts
            .filter((p) => p.type === "text")
            .reduce((acc, p) => {
              if (!p.source) return acc
              return acc.replace(p.source.text.value, p.text)
            }, store.prompt.input)

          const nonTextParts = store.prompt.parts.filter((p) => p.type !== "text")

          const value = trigger === "prompt" ? "" : text
          const content = await Editor.open({ value, renderer })
          if (!content) return

          input.setText(content)

          // Update positions for nonTextParts based on their location in new content
          // Filter out parts whose virtual text was deleted
          // this handles a case where the user edits the text in the editor
          // such that the virtual text moves around or is deleted
          const updatedNonTextParts = nonTextParts
            .map((part) => {
              let virtualText = ""
              if (part.type === "file" && part.source?.text) {
                virtualText = part.source.text.value
              } else if (part.type === "agent" && part.source) {
                virtualText = part.source.value
              }

              if (!virtualText) return part

              const newStart = content.indexOf(virtualText)
              // if the virtual text is deleted, remove the part
              if (newStart === -1) return null

              const newEnd = newStart + virtualText.length

              if (part.type === "file" && part.source?.text) {
                return {
                  ...part,
                  source: {
                    ...part.source,
                    text: {
                      ...part.source.text,
                      start: newStart,
                      end: newEnd,
                    },
                    path: part.source.path,
                  },
                }
              }

              if (part.type === "agent" && part.source) {
                return {
                  ...part,
                  source: {
                    ...part.source,
                    start: newStart,
                    end: newEnd,
                  },
                }
              }

              return part
            })
            .filter((part): part is Exclude<typeof part, null> => part !== null)

          setStore("prompt", {
            input: content,
            // keep only the non-text parts because the text parts were
            // already expanded inline
            parts: updatedNonTextParts,
          })
          restoreExtmarksFromParts(updatedNonTextParts)
          input.cursorOffset = Bun.stringWidth(content)
        },
      },
    ]
  })

  sdk.event.on(TuiEvent.PromptAppend.type, (evt) => {
    const text = evt.properties.text

    // Check if this is a file reference with optional line range (e.g., "@file.ts#L10-20")
    const fileRefMatch = text.match(/^@(.+?)(?:#L(\d+)(?:-(\d+))?)?$/)

    if (fileRefMatch) {
      const filename = fileRefMatch[1]
      const startLine = fileRefMatch[2]
      const endLine = fileRefMatch[3]

      // Build the display text (includes line range)
      const displayText = text // e.g., "@file.ts#L10-20"

      // Build the URL with line range query params
      let url = `file://${process.cwd()}/${filename}`
      if (startLine) {
        const params = new URLSearchParams()
        params.set("start", startLine)
        if (endLine) {
          params.set("end", endLine)
        }
        url += `?${params.toString()}`
      }

      // Build filename for the part (includes line range)
      let partFilename = filename
      if (startLine) {
        partFilename += endLine ? `#L${startLine}-${endLine}` : `#L${startLine}`
      }

      // Insert the text with trailing space
      const currentOffset = input.cursorOffset
      const insertText = displayText + " "
      input.insertText(insertText)

      // Create extmark over the file reference (without trailing space)
      const extmarkStart = currentOffset
      const extmarkEnd = currentOffset + Bun.stringWidth(displayText)

      const extmarkId = input.extmarks.create({
        start: extmarkStart,
        end: extmarkEnd,
        virtual: true,
        styleId: fileStyleId,
        typeId: promptPartTypeId,
      })

      // Add the file part to the prompt
      setStore(
        produce((draft) => {
          const partIndex = draft.prompt.parts.length
          draft.prompt.parts.push({
            type: "file",
            mime: "text/plain",
            filename: partFilename,
            url,
            source: {
              type: "file",
              text: {
                start: extmarkStart,
                end: extmarkEnd,
                value: displayText,
              },
              path: filename,
            },
          })
          draft.extmarkToPartIndex.set(extmarkId, partIndex)
        }),
      )
    } else {
      // Not a file reference, just insert as plain text
      input.insertText(text)
    }
    setTimeout(() => {
      input.getLayoutNode().markDirty()
      input.gotoBufferEnd()
      renderer.requestRender()
    }, 0)
  })

  sdk.event.on(Ide.Event.SelectionChanged.type, (evt) => {
    updateIdeSelection(evt.properties.selection)
  })

  createEffect(() => {
    if (props.disabled) input.cursorColor = theme.backgroundElement
    if (!props.disabled) input.cursorColor = theme.text
  })

  createEffect(() => {
    input.focus()
  })

  onMount(() => {
    promptPartTypeId = input.extmarks.registerType("prompt-part")
  })

  function updateIdeSelection(_selection: Ide.Selection | null) {
    // Selection is now displayed in footer via local.selection
    // No visual insertion in the input needed
    // Content will be included at submit time from local.selection
  }

  function restoreExtmarksFromParts(parts: PromptInfo["parts"]) {
    input.extmarks.clear()
    setStore("extmarkToPartIndex", new Map())

    parts.forEach((part, partIndex) => {
      let start = 0
      let end = 0
      let virtualText = ""
      let styleId: number | undefined

      if (part.type === "file" && part.source?.text) {
        start = part.source.text.start
        end = part.source.text.end
        virtualText = part.source.text.value
        styleId = fileStyleId
      } else if (part.type === "agent" && part.source) {
        start = part.source.start
        end = part.source.end
        virtualText = part.source.value
        styleId = agentStyleId
      } else if (part.type === "text" && part.source?.text) {
        start = part.source.text.start
        end = part.source.text.end
        virtualText = part.source.text.value
        styleId = pasteStyleId
      }

      if (virtualText) {
        const extmarkId = input.extmarks.create({
          start,
          end,
          virtual: true,
          styleId,
          typeId: promptPartTypeId,
        })
        setStore("extmarkToPartIndex", (map: Map<number, number>) => {
          const newMap = new Map(map)
          newMap.set(extmarkId, partIndex)
          return newMap
        })
      }
    })
  }

  function syncExtmarksWithPromptParts() {
    const allExtmarks = input.extmarks.getAllForTypeId(promptPartTypeId)
    const text = input.plainText

    // Track extmarks that need to be recreated with new bounds (for line range absorption)
    const extmarksToRecreate: Array<{
      oldId: number
      start: number
      end: number
      deleteFrom: number
      deleteTo: number
      newVirtualText: string
      styleId: number
      partIndex: number
    }> = []

    setStore(
      produce((draft) => {
        const newMap = new Map<number, number>()
        const newParts: typeof draft.prompt.parts = []

        for (const extmark of allExtmarks) {
          const partIndex = draft.extmarkToPartIndex.get(extmark.id)
          if (partIndex !== undefined) {
            const part = draft.prompt.parts[partIndex]
            if (part) {
              if (part.type === "agent" && part.source) {
                part.source.start = extmark.start
                part.source.end = extmark.end
              } else if (part.type === "file" && part.source?.text) {
                part.source.text.start = extmark.start
                part.source.text.end = extmark.end

                // Check for #L line range suffix after the extmark (with optional whitespace)
                const textAfterExtmark = text.slice(extmark.end)
                const lineRangeMatch = textAfterExtmark.match(LINE_RANGE_SUFFIX_REGEX)

                if (lineRangeMatch) {
                  const whitespace = lineRangeMatch[1]
                  const startLine = lineRangeMatch[2]
                  const endLine = lineRangeMatch[3]
                  const fullMatchLength = lineRangeMatch[0].length
                  const lineRangeSuffix = endLine ? `#L${startLine}-${endLine}` : `#L${startLine}`

                  // Update the URL with line range query params
                  const baseUrl = part.url.split("?")[0]
                  const params = new URLSearchParams()
                  params.set("start", startLine)
                  if (endLine) {
                    params.set("end", endLine)
                  }
                  part.url = `${baseUrl}?${params.toString()}`

                  // Update the filename to include the line range
                  if (part.filename) {
                    const baseFilename = part.filename.replace(/#L\d+(-\d+)?$/, "")
                    part.filename = baseFilename + lineRangeSuffix
                  }

                  // Update the virtual text value to include the line range
                  const baseVirtualText = part.source.text.value.replace(/#L\d+(-\d+)?$/, "")
                  part.source.text.value = baseVirtualText + lineRangeSuffix

                  // Mark for text deletion and extmark recreation
                  // We'll delete the whitespace+#L... text and extend the extmark
                  extmarksToRecreate.push({
                    oldId: extmark.id,
                    start: extmark.start,
                    end: extmark.end + fullMatchLength,
                    deleteFrom: extmark.end,
                    deleteTo: extmark.end + fullMatchLength,
                    newVirtualText: part.source.text.value,
                    styleId: fileStyleId,
                    partIndex: newParts.length,
                  })
                }
              } else if (part.type === "text" && part.source?.text) {
                part.source.text.start = extmark.start
                part.source.text.end = extmark.end
              }
              newMap.set(extmark.id, newParts.length)
              newParts.push(part)
            }
          }
        }

        draft.extmarkToPartIndex = newMap
        draft.prompt.parts = newParts
      }),
    )

    // Recreate extmarks that absorbed line range suffixes
    // Process in reverse order to maintain correct offsets when deleting text
    for (const item of extmarksToRecreate.reverse()) {
      // Save cursor position
      const savedCursor = input.cursorOffset

      // Delete the old extmark
      input.extmarks.delete(item.oldId)

      // Delete the entire range from extmark start to end of line range (including trailing space)
      // Then insert the new combined text with line range
      input.cursorOffset = item.start
      const startCursor = input.logicalCursor
      input.cursorOffset = item.deleteTo
      const endCursor = input.logicalCursor
      input.deleteRange(startCursor.row, startCursor.col, endCursor.row, endCursor.col)

      // Insert the new text: "@file.ts#L10-20 " (with trailing space)
      const newText = item.newVirtualText + " "
      input.cursorOffset = item.start
      input.insertText(newText)

      // Create extmark over the new text (without the trailing space)
      const newExtmarkEnd = item.start + Bun.stringWidth(item.newVirtualText)
      const newExtmarkId = input.extmarks.create({
        start: item.start,
        end: newExtmarkEnd,
        virtual: true,
        styleId: item.styleId,
        typeId: promptPartTypeId,
      })

      // Update the part's source text bounds
      setStore(
        produce((draft) => {
          const part = draft.prompt.parts[item.partIndex]
          if (part?.type === "file" && part.source?.text) {
            part.source.text.start = item.start
            part.source.text.end = newExtmarkEnd
            part.source.text.value = item.newVirtualText
          }
        }),
      )

      setStore("extmarkToPartIndex", (map: Map<number, number>) => {
        const newMap = new Map(map)
        newMap.delete(item.oldId)
        newMap.set(newExtmarkId, item.partIndex)
        return newMap
      })

      // Calculate how much the text length changed and restore cursor position
      const oldLength = item.deleteTo - item.start
      const newLength = newText.length
      const lengthDiff = newLength - oldLength

      if (savedCursor > item.deleteTo) {
        input.cursorOffset = savedCursor + lengthDiff
      } else if (savedCursor > item.start) {
        // Cursor was in the middle of the changed region, put it after the new text
        input.cursorOffset = item.start + newLength
      } else {
        input.cursorOffset = savedCursor
      }
    }
  }

  props.ref?.({
    get focused() {
      return input.focused
    },
    get current() {
      return store.prompt
    },
    focus() {
      input.focus()
    },
    blur() {
      input.blur()
    },
    set(prompt) {
      input.setText(prompt.input)
      setStore("prompt", prompt)
      restoreExtmarksFromParts(prompt.parts)
      input.gotoBufferEnd()
    },
    reset() {
      input.clear()
      input.extmarks.clear()
      setStore("prompt", {
        input: "",
        parts: [],
      })
      setStore("extmarkToPartIndex", new Map())
    },
  })

  async function submit() {
    if (props.disabled) return
    if (autocomplete.visible) return
    if (!store.prompt.input) return
    const trimmed = store.prompt.input.trim()
    if (trimmed === "exit" || trimmed === "quit" || trimmed === ":q") {
      exit()
      return
    }
    const selectedModel = local.model.current()
    if (!selectedModel) {
      promptModelWarning()
      return
    }
    const sessionID = props.sessionID
      ? props.sessionID
      : await (async () => {
          const sessionID = await sdk.client.session.create({}).then((x) => x.data!.id)
          return sessionID
        })()
    const messageID = Identifier.ascending("message")
    let inputText = store.prompt.input

    // IDE selection is displayed in footer only - not injected into message

    // Expand pasted text inline before submitting
    const allExtmarks = input.extmarks.getAllForTypeId(promptPartTypeId)
    const sortedExtmarks = allExtmarks.sort((a: { start: number }, b: { start: number }) => b.start - a.start)

    for (const extmark of sortedExtmarks) {
      const partIndex = store.extmarkToPartIndex.get(extmark.id)
      if (partIndex !== undefined) {
        const part = store.prompt.parts[partIndex]
        if (part?.type === "text" && part.text) {
          const before = inputText.slice(0, extmark.start)
          const after = inputText.slice(extmark.end)
          inputText = before + part.text + after
        }
      }
    }

    // Filter out text parts (pasted content) since they're now expanded inline
    const nonTextParts = store.prompt.parts.filter((part) => part.type !== "text")

    const variant = local.model.variant.current()

    if (store.mode === "shell") {
      sdk.client.session.shell({
        sessionID,
        agent: local.agent.current().name,
        model: {
          providerID: selectedModel.providerID,
          modelID: selectedModel.modelID,
        },
        command: inputText,
      })
      setStore("mode", "normal")
    } else if (
      inputText.startsWith("/") &&
      iife(() => {
        const command = inputText.split(" ")[0].slice(1)
        return sync.data.command.some((x) => x.name === command || x.aliases?.includes(command))
      })
    ) {
      let [command, ...args] = inputText.split(" ")
      const commandName = command.slice(1)
      const resolved = sync.data.command.find((x) => x.name === commandName || x.aliases?.includes(commandName))
      sdk.client.session.command({
        sessionID,
        command: resolved?.name ?? commandName,
        arguments: args.join(" "),
        agent: local.agent.current().name,
        model: `${selectedModel.providerID}/${selectedModel.modelID}`,
        messageID,
        variant,
      })
    } else {
      sdk.client.session.prompt({
        sessionID,
        ...selectedModel,
        messageID,
        agent: local.agent.current().name,
        model: selectedModel,
        variant,
        parts: [
          {
            id: Identifier.ascending("part"),
            type: "text",
            text: inputText,
          },
          ...(local.selection.current()?.text
            ? [
                {
                  id: Identifier.ascending("part"),
                  type: "text" as const,
                  text: `\n\n[IDE Selection: ${
                    local.selection
                      .current()!
                      .filePath.split(/[\/\\]/)
                      .pop() || local.selection.current()!.filePath
                  }:${local.selection.current()!.selection.start.line + 1}-${local.selection.current()!.selection.end.line + 1}]\n\`\`\`\n${local.selection.current()!.text}\n\`\`\``,
                  synthetic: true,
                },
              ]
            : []),
          ...nonTextParts.map((x) => ({
            id: Identifier.ascending("part"),
            ...x,
          })),
        ],
      })
    }
    history.append(store.prompt)
    input.extmarks.clear()
    setStore("prompt", {
      input: "",
      parts: [],
    })
    setStore("extmarkToPartIndex", new Map())
    props.onSubmit?.()

    // temporary hack to make sure the message is sent
    if (!props.sessionID)
      setTimeout(() => {
        route.navigate({
          type: "session",
          sessionID,
        })
      }, 50)
    input.clear()
  }
  const exit = useExit()

  let lastExitAttempt = 0

  async function tryExit() {
    const now = Date.now()
    if (now - lastExitAttempt < 2000) {
      await exit()
      return
    }
    lastExitAttempt = now
    toast.show({
      variant: "warning",
      message: "Press again to exit",
      duration: 2000,
    })
  }

  function pasteText(text: string, virtualText: string) {
    const currentOffset = input.visualCursor.offset
    const extmarkStart = currentOffset
    const extmarkEnd = extmarkStart + virtualText.length

    input.insertText(virtualText + " ")

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId: pasteStyleId,
      typeId: promptPartTypeId,
    })

    setStore(
      produce((draft) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push({
          type: "text" as const,
          text,
          source: {
            text: {
              start: extmarkStart,
              end: extmarkEnd,
              value: virtualText,
            },
          },
        })
        draft.extmarkToPartIndex.set(extmarkId, partIndex)
      }),
    )
  }

  async function pasteImage(file: { filename?: string; content: string; mime: string }) {
    const currentOffset = input.visualCursor.offset
    const extmarkStart = currentOffset
    const count = store.prompt.parts.filter((x) => x.type === "file").length
    const virtualText = `[Image ${count + 1}]`
    const extmarkEnd = extmarkStart + virtualText.length
    const textToInsert = virtualText + " "

    input.insertText(textToInsert)

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId: pasteStyleId,
      typeId: promptPartTypeId,
    })

    const part: Omit<FilePart, "id" | "messageID" | "sessionID"> = {
      type: "file" as const,
      mime: file.mime,
      filename: file.filename,
      url: `data:${file.mime};base64,${file.content}`,
      source: {
        type: "file",
        path: file.filename ?? "",
        text: {
          start: extmarkStart,
          end: extmarkEnd,
          value: virtualText,
        },
      },
    }
    setStore(
      produce((draft) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push(part)
        draft.extmarkToPartIndex.set(extmarkId, partIndex)
      }),
    )
    return
  }

  const highlight = createMemo(() => {
    if (keybind.leader) return theme.border
    if (store.mode === "shell") return theme.primary
    return local.agent.color(local.agent.current().name)
  })

  const showVariant = createMemo(() => {
    const variants = local.model.variant.list()
    if (variants.length === 0) return false
    const current = local.model.variant.current()
    return !!current
  })

  const spinnerDef = createMemo(() => {
    const color = local.agent.color(local.agent.current().name)
    return {
      frames: createFrames({
        color,
        style: "blocks",
        inactiveFactor: 0.6,
        // enableFading: false,
        minAlpha: 0.3,
      }),
      color: createColors({
        color,
        style: "blocks",
        inactiveFactor: 0.6,
        // enableFading: false,
        minAlpha: 0.3,
      }),
    }
  })

  return (
    <>
      <Autocomplete
        sessionID={props.sessionID}
        ref={(r) => (autocomplete = r)}
        anchor={() => anchor}
        input={() => input}
        setPrompt={(cb) => {
          setStore("prompt", produce(cb))
        }}
        setExtmark={(partIndex, extmarkId) => {
          setStore("extmarkToPartIndex", (map: Map<number, number>) => {
            const newMap = new Map(map)
            newMap.set(extmarkId, partIndex)
            return newMap
          })
        }}
        value={store.prompt.input}
        fileStyleId={fileStyleId}
        agentStyleId={agentStyleId}
        promptPartTypeId={() => promptPartTypeId}
      />
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
              placeholder={props.sessionID ? undefined : `Ask anything... "${PLACEHOLDERS[store.placeholder]}"`}
              textColor={theme.text}
              focusedTextColor={theme.text}
              minHeight={1}
              maxHeight={6}
              onContentChange={() => {
                const value = input.plainText
                setStore("prompt", "input", value)
                autocomplete.onInput(value)
                syncExtmarksWithPromptParts()
              }}
              keyBindings={textareaKeybindings()}
              onKeyDown={async (e) => {
                if (props.disabled) {
                  e.preventDefault()
                  return
                }
                // Handle clipboard paste (Ctrl+V) - check for images first on Windows
                // This is needed because Windows terminal doesn't properly send image data
                // through bracketed paste, so we need to intercept the keypress and
                // directly read from clipboard before the terminal handles it
                if (keybind.match("input_paste", e)) {
                  const content = await Clipboard.read()
                  if (content?.mime.startsWith("image/")) {
                    e.preventDefault()
                    await pasteImage({
                      filename: "clipboard",
                      mime: content.mime,
                      content: content.data,
                    })
                    return
                  }
                  // If no image, let the default paste behavior continue
                }
                if (keybind.match("input_clear", e) && store.prompt.input !== "") {
                  input.clear()
                  input.extmarks.clear()
                  setStore("prompt", {
                    input: "",
                    parts: [],
                  })
                  setStore("extmarkToPartIndex", new Map())
                  return
                }
                if (keybind.match("app_exit", e)) {
                  await tryExit()
                  return
                }
                if (keybind.match("session_search", e)) {
                  props.onSearchToggle?.()
                  e.preventDefault()
                  return
                }
                if (e.name === "!" && input.visualCursor.offset === 0) {
                  setStore("mode", "shell")
                  e.preventDefault()
                  return
                }
                if (store.mode === "shell") {
                  if ((e.name === "backspace" && input.visualCursor.offset === 0) || e.name === "escape") {
                    setStore("mode", "normal")
                    e.preventDefault()
                    return
                  }
                }
                if (store.mode === "normal") autocomplete.onKeyDown(e)
                // Handle variant cycle before autocomplete visible check
                // This must be at element level because global useKeyboard doesn't receive
                // events properly when textarea is focused (see issue #222)
                if (keybind.match("variant_cycle", e)) {
                  e.preventDefault()
                  if (local.model.variant.list().length === 0) return
                  local.model.variant.cycle()
                  return
                }
                if (!autocomplete.visible) {
                  if (
                    (keybind.match("history_previous", e) && input.cursorOffset === 0) ||
                    (keybind.match("history_next", e) && input.cursorOffset === input.plainText.length)
                  ) {
                    const direction = keybind.match("history_previous", e) ? -1 : 1
                    const item = history.move(direction, input.plainText)

                    if (item) {
                      input.setText(item.input)
                      setStore("prompt", item)
                      restoreExtmarksFromParts(item.parts)
                      e.preventDefault()
                      if (direction === -1) input.cursorOffset = 0
                      if (direction === 1) input.cursorOffset = input.plainText.length
                    }
                    return
                  }

                  if (keybind.match("history_previous", e) && input.visualCursor.visualRow === 0) input.cursorOffset = 0
                  if (keybind.match("history_next", e) && input.visualCursor.visualRow === input.height - 1)
                    input.cursorOffset = input.plainText.length
                }
              }}
              onSubmit={submit}
              onPaste={async (event: PasteEvent) => {
                if (props.disabled) {
                  event.preventDefault()
                  return
                }

                // Normalize line endings at the boundary
                // Windows ConPTY/Terminal often sends CR-only newlines in bracketed paste
                // Replace CRLF first, then any remaining CR
                const normalizedText = event.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
                const pastedContent = normalizedText.trim()
                if (!pastedContent) {
                  command.trigger("prompt.paste")
                  return
                }

                // Handle file:// URIs or text/uri-list (common for drag-and-drop on Linux)
                if (pastedContent.includes("file://")) {
                  const paths = parseUriList(pastedContent)
                  if (paths.length > 0) {
                    let handled = false
                    for (const path of paths) {
                      try {
                        const file = Bun.file(path)
                        if (file.type.startsWith("image/")) {
                          const content = await file
                            .arrayBuffer()
                            .then((buffer) => Buffer.from(buffer).toString("base64"))
                            .catch(() => {})
                          if (content) {
                            await pasteImage({
                              filename: file.name,
                              mime: file.type,
                              content,
                            })
                            handled = true
                            continue
                          }
                        }
                      } catch {}
                    }

                    if (handled) {
                      event.preventDefault()
                      return
                    }
                  }
                }

                // trim ' from the beginning and end of the pasted content. just
                // ' and nothing else
                const filepath = pastedContent.replace(/^'+|'+$/g, "").replace(/\\ /g, " ")
                const isUrl = /^(https?):\/\//.test(filepath)
                if (!isUrl) {
                  try {
                    const file = Bun.file(filepath)
                    // Handle SVG as raw text content, not as base64 image
                    if (file.type === "image/svg+xml") {
                      event.preventDefault()
                      const content = await file.text().catch(() => {})
                      if (content) {
                        pasteText(content, `[SVG: ${file.name ?? "image"}]`)
                        return
                      }
                    }
                    if (file.type.startsWith("image/")) {
                      event.preventDefault()
                      const content = await file
                        .arrayBuffer()
                        .then((buffer) => Buffer.from(buffer).toString("base64"))
                        .catch(() => {})
                      if (content) {
                        await pasteImage({
                          filename: file.name,
                          mime: file.type,
                          content,
                        })
                        return
                      }
                    }
                  } catch {}
                }

                const lineCount = (pastedContent.match(/\n/g)?.length ?? 0) + 1
                if (
                  (lineCount >= 3 || pastedContent.length > 150) &&
                  !sync.data.config.experimental?.disable_paste_summary
                ) {
                  event.preventDefault()
                  pasteText(pastedContent, `[Pasted ~${lineCount} lines]`)
                  return
                }
              }}
              ref={(r: TextareaRenderable) => {
                input = r
                setTimeout(() => {
                  input.cursorColor = theme.text
                }, 0)
              }}
              onMouseDown={(r: MouseEvent) => r.target?.focus()}
              focusedBackgroundColor={theme.backgroundElement}
              cursorColor={theme.text}
              syntaxStyle={syntax()}
            />
            <Show when={tall()}>
              <box flexDirection="row" flexShrink={0} paddingTop={1} gap={1}>
                <text fg={highlight()}>
                  {store.mode === "shell" ? "Shell" : Locale.titlecase(local.agent.current().name)}{" "}
                </text>
                <Show when={store.mode === "normal"}>
                  <box flexDirection="row" gap={1}>
                    <text flexShrink={0} fg={keybind.leader ? theme.textMuted : theme.text}>
                      {local.model.parsed().model}
                    </text>
                    <text fg={theme.textMuted}>{local.model.parsed().provider}</text>
                    <Show when={showVariant()}>
                      <text fg={theme.textMuted}>·</text>
                      <text>
                        <span style={{ fg: theme.warning, bold: true }}>{local.model.variant.current()}</span>
                      </text>
                    </Show>
                  </box>
                </Show>
              </box>
            </Show>
          </box>
        </box>
        <box
          height={1}
          border={["left"]}
          borderColor={highlight()}
          customBorderChars={{
            ...EmptyBorder,
            vertical: theme.backgroundElement.a !== 0 ? "╹" : " ",
          }}
        >
          <box
            height={1}
            border={["bottom"]}
            borderColor={theme.backgroundElement}
            customBorderChars={
              theme.backgroundElement.a !== 0
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
        <box flexDirection="row" justifyContent="space-between">
          <Switch>
            <Match when={status().type !== "idle"}>
              <box
                flexDirection="row"
                gap={1}
                flexGrow={1}
                justifyContent={status().type === "retry" ? "space-between" : "flex-start"}
              >
                <box flexShrink={0} flexDirection="row" gap={1}>
                  <box marginLeft={1}>
                    <Show when={kv.get("animations_enabled", true)} fallback={<text fg={theme.textMuted}>[⋯]</text>}>
                      <spinner color={spinnerDef().color} frames={spinnerDef().frames} interval={40} />
                    </Show>
                  </box>
                  <box flexDirection="row" gap={1} flexShrink={0}>
                    {(() => {
                      const retry = createMemo(() => {
                        const s = status()
                        if (s.type !== "retry") return
                        return s
                      })
                      const message = createMemo(() => {
                        const r = retry()
                        if (!r) return
                        if (r.message.includes("exceeded your current quota") && r.message.includes("gemini"))
                          return "gemini is way too hot right now"
                        if (r.message.length > 80) return r.message.slice(0, 80) + "..."
                        return r.message
                      })
                      const isTruncated = createMemo(() => {
                        const r = retry()
                        if (!r) return false
                        return r.message.length > 120
                      })
                      const [seconds, setSeconds] = createSignal(0)
                      onMount(() => {
                        const timer = setInterval(() => {
                          const next = retry()?.next
                          if (next) setSeconds(Math.round((next - Date.now()) / 1000))
                        }, 1000)

                        onCleanup(() => {
                          clearInterval(timer)
                        })
                      })
                      const handleMessageClick = () => {
                        const r = retry()
                        if (!r) return
                        if (isTruncated()) {
                          DialogAlert.show(dialog, "Retry Error", r.message)
                        }
                      }

                      const retryText = () => {
                        const r = retry()
                        if (!r) return ""
                        const baseMessage = message()
                        const truncatedHint = isTruncated() ? " (click to expand)" : ""
                        const retryInfo = ` [retrying ${seconds() > 0 ? `in ${seconds()}s ` : ""}attempt #${r.attempt}]`
                        return baseMessage + truncatedHint + retryInfo
                      }

                      return (
                        <Show when={retry()}>
                          <box onMouseUp={handleMessageClick}>
                            <text fg={theme.error}>{retryText()}</text>
                          </box>
                        </Show>
                      )
                    })()}
                  </box>
                </box>
                <text fg={store.interrupt > 0 ? theme.primary : theme.text}>
                  esc{" "}
                  <span style={{ fg: store.interrupt > 0 ? theme.primary : theme.textMuted }}>
                    {store.interrupt > 0 ? "again to interrupt" : "interrupt"}
                  </span>
                </text>
              </box>
            </Match>
            <Match when={!tall()}>
              <box flexDirection="row" gap={1}>
                <text fg={highlight()}>
                  {store.mode === "shell" ? "Shell" : Locale.titlecase(local.agent.current().name)}{" "}
                </text>
                <Show when={store.mode === "normal"}>
                  <box flexDirection="row" gap={1}>
                    <text flexShrink={0} fg={keybind.leader ? theme.textMuted : theme.text}>
                      {local.model.parsed().model}
                    </text>
                    <text fg={theme.textMuted}>{local.model.parsed().provider}</text>
                    <Show when={showVariant()}>
                      <text fg={theme.textMuted}>·</text>
                      <text>
                        <span style={{ fg: theme.warning, bold: true }}>{local.model.variant.current()}</span>
                      </text>
                    </Show>
                  </box>
                </Show>
              </box>
            </Match>
          </Switch>
          <box gap={2} flexDirection="row" marginLeft="auto">
            <Switch>
              <Match when={store.mode === "normal"}>
                <Show when={wide()}>
                  <text fg={theme.text}>
                    {keybind.print("agent_cycle")} <span style={{ fg: theme.textMuted }}>switch agent</span>
                  </text>
                </Show>
                <Show when={!wide()}>
                  <text fg={theme.text}>
                    {keybind.print("sidebar_toggle")} <span style={{ fg: theme.textMuted }}>sidebar</span>
                  </text>
                </Show>
                <text fg={theme.text}>
                  {keybind.print("command_list")} <span style={{ fg: theme.textMuted }}>commands</span>
                </text>
              </Match>
              <Match when={store.mode === "shell"}>
                <text fg={theme.text}>
                  esc <span style={{ fg: theme.textMuted }}>exit shell mode</span>
                </text>
              </Match>
            </Switch>
          </box>
        </box>
      </box>
    </>
  )
}
