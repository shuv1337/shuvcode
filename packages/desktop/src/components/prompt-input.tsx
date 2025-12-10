import { useFilteredList } from "@opencode-ai/ui/hooks"
import { createEffect, on, Component, Show, For, onMount, onCleanup, Switch, Match, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { createFocusSignal } from "@solid-primitives/active-element"
import { useLocal } from "@/context/local"
import { DateTime } from "luxon"
import { ContentPart, DEFAULT_PROMPT, isPromptEqual, Prompt, useSession } from "@/context/session"
import { useSDK } from "@/context/sdk"
import { useNavigate } from "@solidjs/router"
import { useSync } from "@/context/sync"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { SelectDialog } from "@opencode-ai/ui/select-dialog"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Select } from "@opencode-ai/ui/select"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { type IconName } from "@opencode-ai/ui/icons/provider"
import type { Command } from "@opencode-ai/sdk/v2"

interface PromptInputProps {
  class?: string
  ref?: (el: HTMLDivElement) => void
}

type UICommand = {
  name: string
  description: string
  builtin: true
}

const UI_COMMANDS: UICommand[] = [
  { name: "undo", description: "Undo the last message", builtin: true },
  { name: "redo", description: "Redo the last undone message", builtin: true },
]

const PLACEHOLDERS = [
  "Fix a TODO in the codebase",
  "What is the tech stack of this project?",
  "Fix broken tests",
  "Explain how authentication works",
  "Find and fix security vulnerabilities",
  "Add unit tests for the user service",
  "Refactor this function to be more readable",
  "What does this error mean?",
  "Help me debug this issue",
  "Generate API documentation",
  "Optimize database queries",
  "Add input validation",
  "Create a new component for...",
  "How do I deploy this project?",
  "Review my code for best practices",
  "Add error handling to this function",
  "Explain this regex pattern",
  "Convert this to TypeScript",
  "Add logging throughout the codebase",
  "What dependencies are outdated?",
  "Help me write a migration script",
  "Implement caching for this endpoint",
  "Add pagination to this list",
  "Create a CLI command for...",
  "How do environment variables work here?",
]

export const PromptInput: Component<PromptInputProps> = (props) => {
  const navigate = useNavigate()
  const sdk = useSDK()
  const sync = useSync()
  const local = useLocal()
  const session = useSession()
  let editorRef!: HTMLDivElement

  const [store, setStore] = createStore<{
    popoverIsOpen: boolean
    popoverMode: "file" | "command" | null
    inputMode: "normal" | "shell"
  }>({
    popoverIsOpen: false,
    popoverMode: null,
    inputMode: "normal",
  })

  const [placeholder, setPlaceholder] = createSignal(Math.floor(Math.random() * PLACEHOLDERS.length))

  onMount(() => {
    const interval = setInterval(() => {
      setPlaceholder((prev) => (prev + 1) % PLACEHOLDERS.length)
    }, 6500)
    onCleanup(() => clearInterval(interval))
  })

  createEffect(() => {
    session.id
    editorRef.focus()
    setStore("inputMode", "normal")
  })

  const isFocused = createFocusSignal(() => editorRef)

  const handlePaste = (event: ClipboardEvent) => {
    event.preventDefault()
    event.stopPropagation()
    // @ts-expect-error
    const plainText = (event.clipboardData || window.clipboardData)?.getData("text/plain") ?? ""
    addPart({ type: "text", content: plainText, start: 0, end: 0 })
  }

  onMount(() => {
    editorRef.addEventListener("paste", handlePaste)
    onCleanup(() => {
      editorRef?.removeEventListener("paste", handlePaste)
    })
  })

  createEffect(() => {
    if (isFocused()) {
      handleInput()
    } else {
      setStore({ popoverIsOpen: false, popoverMode: null })
    }
  })

  const handleFileSelect = (path: string | undefined) => {
    if (!path) return
    addPart({ type: "file", path, content: "@" + path, start: 0, end: 0 })
  }

  type AnyCommand = Command | UICommand
  const isUICommand = (cmd: AnyCommand): cmd is UICommand => "builtin" in cmd

  const handleCommandSelect = (command: AnyCommand | undefined) => {
    if (!command) return
    editorRef.innerHTML = ""
    // UI commands like /undo and /redo don't need trailing space for args
    const needsSpace = !isUICommand(command)
    editorRef.appendChild(document.createTextNode(`/${command.name}${needsSpace ? " " : ""}`))
    handleInput()
    setStore({ popoverIsOpen: false, popoverMode: null })
    const range = document.createRange()
    range.selectNodeContents(editorRef)
    range.collapse(false)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
  }

  const commandList = useFilteredList<AnyCommand>({
    items: async () => [...UI_COMMANDS, ...(sync.data.command ?? [])],
    key: (x) => x?.name ?? "",
    filterKeys: ["name", "description"],
    onSelect: handleCommandSelect,
  })

  const { flat, active, onInput, onKeyDown, refetch } = useFilteredList<string>({
    items: local.file.searchFilesAndDirectories,
    key: (x) => x,
    onSelect: handleFileSelect,
  })

  createEffect(() => {
    local.model.recent()
    refetch()
  })

  createEffect(
    on(
      () => session.prompt.current(),
      (currentParts) => {
        const domParts = parseFromDOM()
        if (isPromptEqual(currentParts, domParts)) return

        const selection = window.getSelection()
        let cursorPosition: number | null = null
        if (selection && selection.rangeCount > 0 && editorRef.contains(selection.anchorNode)) {
          cursorPosition = getCursorPosition(editorRef)
        }

        editorRef.innerHTML = ""
        currentParts.forEach((part) => {
          if (part.type === "text") {
            editorRef.appendChild(document.createTextNode(part.content))
          } else if (part.type === "file") {
            const pill = document.createElement("span")
            pill.textContent = part.content
            pill.setAttribute("data-type", "file")
            pill.setAttribute("data-path", part.path)
            pill.setAttribute("contenteditable", "false")
            pill.style.userSelect = "text"
            pill.style.cursor = "default"
            editorRef.appendChild(pill)
          }
        })

        if (cursorPosition !== null) {
          setCursorPosition(editorRef, cursorPosition)
        }
      },
    ),
  )

  const parseFromDOM = (): Prompt => {
    const newParts: Prompt = []
    let position = 0
    editorRef.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent) {
          const content = node.textContent
          newParts.push({ type: "text", content, start: position, end: position + content.length })
          position += content.length
        }
      } else if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.type) {
        switch ((node as HTMLElement).dataset.type) {
          case "file":
            const content = node.textContent!
            newParts.push({
              type: "file",
              path: (node as HTMLElement).dataset.path!,
              content,
              start: position,
              end: position + content.length,
            })
            position += content.length
            break
          default:
            break
        }
      }
    })
    if (newParts.length === 0) newParts.push(...DEFAULT_PROMPT)
    return newParts
  }

  const handleInput = () => {
    const rawParts = parseFromDOM()
    const cursorPosition = getCursorPosition(editorRef)
    const rawText = rawParts.map((p) => p.content).join("")

    // Skip autocomplete detection in shell mode
    if (store.inputMode === "shell") {
      session.prompt.set(rawParts, cursorPosition)
      return
    }

    // Slash command detection - must be at start of input
    if (rawText.startsWith("/") && cursorPosition <= rawText.split(" ")[0].length) {
      // Hide autocomplete when command has arguments (e.g., "/command arg")
      if (rawText.match(/^\/\S+\s+\S+/)) {
        setStore({ popoverIsOpen: false, popoverMode: null })
      } else {
        const slashMatch = rawText.match(/^\/(\S*)/)
        if (slashMatch) {
          commandList.onInput(slashMatch[1])
          setStore({ popoverIsOpen: true, popoverMode: "command" })
          session.prompt.set(rawParts, cursorPosition)
          return
        }
      }
    }

    // @ file mention detection
    const atMatch = rawText.substring(0, cursorPosition).match(/@(\S*)$/)
    if (atMatch) {
      onInput(atMatch[1])
      setStore({ popoverIsOpen: true, popoverMode: "file" })
    } else if (store.popoverIsOpen) {
      setStore({ popoverIsOpen: false, popoverMode: null })
    }

    session.prompt.set(rawParts, cursorPosition)
  }

  const addPart = (part: ContentPart) => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return

    const cursorPosition = getCursorPosition(editorRef)
    const prompt = session.prompt.current()
    const rawText = prompt.map((p) => p.content).join("")
    const textBeforeCursor = rawText.substring(0, cursorPosition)
    const atMatch = textBeforeCursor.match(/@(\S*)$/)

    if (part.type === "file") {
      const pill = document.createElement("span")
      pill.textContent = part.content
      pill.setAttribute("data-type", "file")
      pill.setAttribute("data-path", part.path)
      pill.setAttribute("contenteditable", "false")
      pill.style.userSelect = "text"
      pill.style.cursor = "default"

      const gap = document.createTextNode(" ")
      const range = selection.getRangeAt(0)

      if (atMatch) {
        // let node: Node | null = range.startContainer
        // let offset = range.startOffset
        let runningLength = 0

        const walker = document.createTreeWalker(editorRef, NodeFilter.SHOW_TEXT, null)
        let currentNode = walker.nextNode()
        while (currentNode) {
          const textContent = currentNode.textContent || ""
          if (runningLength + textContent.length >= atMatch.index!) {
            const localStart = atMatch.index! - runningLength
            const localEnd = cursorPosition - runningLength
            if (currentNode === range.startContainer || runningLength + textContent.length >= cursorPosition) {
              range.setStart(currentNode, localStart)
              range.setEnd(currentNode, Math.min(localEnd, textContent.length))
              break
            }
          }
          runningLength += textContent.length
          currentNode = walker.nextNode()
        }
      }

      range.deleteContents()
      range.insertNode(gap)
      range.insertNode(pill)
      range.setStartAfter(gap)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    } else if (part.type === "text") {
      const textNode = document.createTextNode(part.content)
      const range = selection.getRangeAt(0)
      range.deleteContents()
      range.insertNode(textNode)
      range.setStartAfter(textNode)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    }

    handleInput()
    setStore("popoverIsOpen", false)
  }

  const abort = () =>
    sdk.client.session.abort({
      sessionID: session.id!,
    })

  const handleKeyDown = (event: KeyboardEvent) => {
    // Shell mode entry - ! at position 0
    if (event.key === "!" && getCursorPosition(editorRef) === 0 && store.inputMode === "normal") {
      event.preventDefault()
      setStore("inputMode", "shell")
      return
    }

    // Shell mode exit - backspace at position 0 or escape
    if (store.inputMode === "shell") {
      if (event.key === "Escape") {
        event.preventDefault()
        setStore("inputMode", "normal")
        return
      }
      if (event.key === "Backspace" && getCursorPosition(editorRef) === 0) {
        event.preventDefault()
        setStore("inputMode", "normal")
        return
      }
    }

    if (store.popoverIsOpen && (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter")) {
      if (store.popoverMode === "file") {
        onKeyDown(event)
      } else if (store.popoverMode === "command") {
        commandList.onKeyDown(event)
      }
      event.preventDefault()
      return
    }
    if (event.key === "Enter" && !event.shiftKey) {
      handleSubmit(event)
    }
    if (event.key === "Escape") {
      if (store.popoverIsOpen) {
        setStore({ popoverIsOpen: false, popoverMode: null })
      } else if (session.working()) {
        abort()
      }
    }
  }

  const handleUndo = async () => {
    const sessionInfo = session.info()
    if (!sessionInfo) return

    // Abort if working
    if (session.working()) {
      await sdk.client.session.abort({ sessionID: sessionInfo.id }).catch(() => {})
    }

    const revertPoint = sessionInfo.revert?.messageID
    const messages = session.messages.all()
    // Find the last user message before the revert point (or last user message if no revert)
    const message = messages.findLast((x) => (!revertPoint || x.id < revertPoint) && x.role === "user")
    if (!message) return

    await sdk.client.session.revert({
      sessionID: sessionInfo.id,
      messageID: message.id,
    })

    // Restore the message content to the prompt
    const parts = sync.data.part[message.id] ?? []
    const textContent = parts
      .filter((p) => p.type === "text" && !p.synthetic)
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("")
    editorRef.innerHTML = ""
    editorRef.appendChild(document.createTextNode(textContent))
    session.prompt.set([{ type: "text", content: textContent, start: 0, end: textContent.length }], textContent.length)
  }

  const handleRedo = async () => {
    const sessionInfo = session.info()
    if (!sessionInfo) return

    const revertPoint = sessionInfo.revert?.messageID
    if (!revertPoint) return // Nothing to redo

    const messages = session.messages.all()
    // Find the next user message after the revert point
    const message = messages.find((x) => x.role === "user" && x.id > revertPoint)

    if (!message) {
      // At the end, unrevert all
      await sdk.client.session.unrevert({ sessionID: sessionInfo.id })
      editorRef.innerHTML = ""
      session.prompt.set([{ type: "text", content: "", start: 0, end: 0 }], 0)
    } else {
      // Move revert point forward
      await sdk.client.session.revert({
        sessionID: sessionInfo.id,
        messageID: message.id,
      })
    }
  }

  const handleSubmit = async (event: Event) => {
    event.preventDefault()
    const prompt = session.prompt.current()
    const text = prompt.map((part) => part.content).join("")
    if (text.trim().length === 0) {
      if (session.working()) abort()
      return
    }

    // Shell mode submission
    if (store.inputMode === "shell") {
      let existing = session.info()
      if (!existing) {
        const created = await sdk.client.session.create()
        existing = created.data ?? undefined
        if (existing) navigate(existing.id)
      }
      if (!existing) return

      session.layout.setActiveTab(undefined)
      session.messages.setActive(undefined)
      editorRef.innerHTML = ""
      session.prompt.set([{ type: "text", content: "", start: 0, end: 0 }], 0)
      setStore("inputMode", "normal")

      try {
        await sdk.client.session.shell({
          sessionID: existing.id,
          agent: local.agent.current()!.name,
          model: {
            providerID: local.model.current()!.provider.id,
            modelID: local.model.current()!.id,
          },
          command: text,
        })
      } catch (error) {
        console.error("Shell command execution failed:", error)
      }
      return
    }

    // UI command detection (undo/redo)
    if (text === "/undo") {
      editorRef.innerHTML = ""
      session.prompt.set([{ type: "text", content: "", start: 0, end: 0 }], 0)
      await handleUndo()
      return
    }
    if (text === "/redo") {
      editorRef.innerHTML = ""
      session.prompt.set([{ type: "text", content: "", start: 0, end: 0 }], 0)
      await handleRedo()
      return
    }

    // SDK command detection
    const isSlashCommand = text.startsWith("/")
    let matchedCommand: Command | undefined
    if (isSlashCommand) {
      const commandName = text.split(" ")[0].slice(1) // Remove leading "/"
      matchedCommand = sync.data.command.find((c) => c.name === commandName)
    }

    let existing = session.info()
    if (!existing) {
      const created = await sdk.client.session.create()
      existing = created.data ?? undefined
      if (existing) navigate(existing.id)
    }
    if (!existing) return

    session.layout.setActiveTab(undefined)
    session.messages.setActive(undefined)
    // Clear the editor DOM directly to ensure it's empty
    editorRef.innerHTML = ""
    session.prompt.set([{ type: "text", content: "", start: 0, end: 0 }], 0)

    if (matchedCommand) {
      const args = text.split(" ").slice(1).join(" ")
      try {
        await sdk.client.session.command({
          sessionID: existing.id,
          command: matchedCommand.name,
          arguments: args,
          agent: local.agent.current()!.name,
          model: `${local.model.current()!.provider.id}/${local.model.current()!.id}`,
        })
      } catch (error) {
        console.error("Command execution failed:", error)
      }
    } else {
      const toAbsolutePath = (path: string) => (path.startsWith("/") ? path : sync.absolute(path))
      const attachments = prompt.filter((part) => part.type === "file")

      const attachmentParts = attachments.map((attachment) => {
        const absolute = toAbsolutePath(attachment.path)
        const query = attachment.selection
          ? `?start=${attachment.selection.startLine}&end=${attachment.selection.endLine}`
          : ""
        return {
          type: "file" as const,
          mime: "text/plain",
          url: `file://${absolute}${query}`,
          filename: getFilename(attachment.path),
          source: {
            type: "file" as const,
            text: {
              value: attachment.content,
              start: attachment.start,
              end: attachment.end,
            },
            path: absolute,
          },
        }
      })

      sdk.client.session.prompt({
        sessionID: existing.id,
        agent: local.agent.current()!.name,
        model: {
          modelID: local.model.current()!.id,
          providerID: local.model.current()!.provider.id,
        },
        parts: [
          {
            type: "text",
            text,
          },
          ...attachmentParts,
        ],
      })
    }
  }

  return (
    <div class="relative size-full _max-h-[320px] flex flex-col gap-3">
      <Show when={store.popoverIsOpen}>
        <div
          class="absolute inset-x-0 -top-3 -translate-y-full origin-bottom-left max-h-[252px] min-h-10
                 overflow-auto no-scrollbar flex flex-col p-2 pb-0 rounded-md
                 border border-border-base bg-surface-raised-stronger-non-alpha shadow-md"
        >
          <Show when={store.popoverMode === "file"}>
            <Show when={flat().length > 0} fallback={<div class="text-text-weak px-2">No matching files</div>}>
              <For each={flat()}>
                {(i) => (
                  <button
                    classList={{
                      "w-full flex items-center justify-between rounded-md": true,
                      "bg-surface-raised-base-hover": active() === i,
                    }}
                    onClick={() => handleFileSelect(i)}
                  >
                    <div class="flex items-center gap-x-2 grow min-w-0">
                      <FileIcon node={{ path: i, type: "file" }} class="shrink-0 size-4" />
                      <div class="flex items-center text-14-regular">
                        <span class="text-text-weak whitespace-nowrap overflow-hidden overflow-ellipsis truncate min-w-0">
                          {getDirectory(i)}
                        </span>
                        <Show when={!i.endsWith("/")}>
                          <span class="text-text-strong whitespace-nowrap">{getFilename(i)}</span>
                        </Show>
                      </div>
                    </div>
                    <div class="flex items-center gap-x-1 text-text-muted/40 shrink-0"></div>
                  </button>
                )}
              </For>
            </Show>
          </Show>
          <Show when={store.popoverMode === "command"}>
            <Show
              when={commandList.flat().length > 0}
              fallback={<div class="text-text-weak px-2">No matching commands</div>}
            >
              <For each={commandList.flat()}>
                {(cmd) => {
                  const isActive = () => commandList.active() === cmd.name
                  return (
                    <button
                      ref={(el) => {
                        createEffect(() => {
                          if (isActive()) el.scrollIntoView({ block: "nearest" })
                        })
                      }}
                      classList={{
                        "w-full flex items-center justify-between rounded-md p-2": true,
                        "bg-surface-raised-base-hover": isActive(),
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        handleCommandSelect(cmd)
                      }}
                    >
                      <div class="flex flex-col items-start">
                        <span class="text-14-medium text-text-strong">/{cmd.name}</span>
                        <Show when={cmd.description}>
                          <span class="text-12-regular text-text-weak">{cmd.description}</span>
                        </Show>
                      </div>
                    </button>
                  )
                }}
              </For>
            </Show>
          </Show>
        </div>
      </Show>
      <form
        onSubmit={handleSubmit}
        classList={{
          "bg-surface-raised-stronger-non-alpha border border-border-strong-base": true,
          "rounded-md overflow-clip focus-within:border-transparent focus-within:shadow-xs-border-select": true,
          [props.class ?? ""]: !!props.class,
        }}
      >
        <div class="relative max-h-[240px] overflow-y-auto">
          <div
            ref={(el) => {
              editorRef = el
              props.ref?.(el)
            }}
            contenteditable="true"
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            classList={{
              "w-full px-5 py-3 text-14-regular text-text-strong focus:outline-none whitespace-pre-wrap": true,
              "[&>[data-type=file]]:text-icon-info-active": true,
            }}
          />
          <Show when={!session.prompt.dirty()}>
            <div class="absolute top-0 left-0 px-5 py-3 text-14-regular text-text-weak pointer-events-none">
              Ask anything... "{PLACEHOLDERS[placeholder()]}"
            </div>
          </Show>
        </div>
        <div class="relative p-3 flex items-center justify-between">
          <div class="flex items-center justify-start gap-1">
            <Show
              when={store.inputMode === "normal"}
              fallback={
                <div class="flex items-center gap-1.5 px-2 py-1 text-14-medium text-accent-text">
                  <Icon name="terminal" class="size-4" />
                  <span>Shell</span>
                </div>
              }
            >
              <Select
                options={local.agent.list().map((agent) => agent.name)}
                current={local.agent.current().name}
                onSelect={local.agent.set}
                class="capitalize"
                variant="ghost"
              />
            </Show>
            <Show when={store.inputMode === "normal"}>
              <SelectDialog
                title="Select model"
                placeholder="Search models"
                emptyMessage="No model results"
                key={(x) => `${x.provider.id}:${x.id}`}
                items={local.model.list()}
                current={local.model.current()}
                filterKeys={["provider.name", "name", "id"]}
                groupBy={(x) => (local.model.recent().includes(x) ? "Recent" : x.provider.name)}
                sortGroupsBy={(a, b) => {
                  const order = ["opencode", "anthropic", "github-copilot", "openai", "google", "openrouter", "vercel"]
                  if (a.category === "Recent" && b.category !== "Recent") return -1
                  if (b.category === "Recent" && a.category !== "Recent") return 1
                  const aProvider = a.items[0].provider.id
                  const bProvider = b.items[0].provider.id
                  if (order.includes(aProvider) && !order.includes(bProvider)) return -1
                  if (!order.includes(aProvider) && order.includes(bProvider)) return 1
                  return order.indexOf(aProvider) - order.indexOf(bProvider)
                }}
                onSelect={(x) =>
                  local.model.set(x ? { modelID: x.id, providerID: x.provider.id } : undefined, { recent: true })
                }
                trigger={
                  <Button as="div" variant="ghost">
                    {local.model.current()?.name ?? "Select model"}
                    <span class="ml-0.5 text-text-weak text-12-regular">{local.model.current()?.provider.name}</span>
                    <Icon name="chevron-down" size="small" />
                  </Button>
                }
              >
                {(i) => (
                  <div class="w-full flex items-center justify-between gap-x-3">
                    <div class="flex items-center gap-x-2.5 text-text-muted grow min-w-0">
                      <ProviderIcon name={i.provider.id as IconName} class="size-6 p-0.5 shrink-0" />
                      <div class="flex gap-x-3 items-baseline flex-[1_0_0]">
                        <span class="text-14-medium text-text-strong overflow-hidden text-ellipsis">{i.name}</span>
                        <Show when={false}>
                          <span class="text-12-medium text-text-weak overflow-hidden text-ellipsis truncate min-w-0">
                            {DateTime.fromFormat("unknown", "yyyy-MM-dd").toFormat("LLL yyyy")}
                          </span>
                        </Show>
                      </div>
                    </div>
                    <Show when={!i.cost || i.cost?.input === 0}>
                      <div class="overflow-hidden text-12-medium text-text-strong">Free</div>
                    </Show>
                  </div>
                )}
              </SelectDialog>
            </Show>
          </div>
          <Tooltip
            placement="top"
            value={
              <Switch>
                <Match when={session.working()}>
                  <div class="flex items-center gap-2">
                    <span>Stop</span>
                    <span class="text-icon-base text-12-medium text-[10px]!">ESC</span>
                  </div>
                </Match>
                <Match when={true}>
                  <div class="flex items-center gap-2">
                    <span>Send</span>
                    <Icon name="enter" size="small" class="text-icon-base" />
                  </div>
                </Match>
              </Switch>
            }
          >
            <IconButton
              type="submit"
              disabled={!session.prompt.dirty() && !session.working()}
              icon={session.working() ? "stop" : "arrow-up"}
              variant="primary"
              class="h-7 w-8 absolute right-2 bottom-2"
            />
          </Tooltip>
        </div>
      </form>
    </div>
  )
}

function getCursorPosition(parent: HTMLElement): number {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return 0
  const range = selection.getRangeAt(0)
  const preCaretRange = range.cloneRange()
  preCaretRange.selectNodeContents(parent)
  preCaretRange.setEnd(range.startContainer, range.startOffset)
  return preCaretRange.toString().length
}

function setCursorPosition(parent: HTMLElement, position: number) {
  let remaining = position
  let node = parent.firstChild
  while (node) {
    const length = node.textContent ? node.textContent.length : 0
    const isText = node.nodeType === Node.TEXT_NODE
    const isFile = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.type === "file"

    if (isText && remaining <= length) {
      const range = document.createRange()
      const selection = window.getSelection()
      range.setStart(node, remaining)
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }

    if (isFile && remaining <= length) {
      const range = document.createRange()
      const selection = window.getSelection()
      range.setStartAfter(node)
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }

    remaining -= length
    node = node.nextSibling
  }

  const fallbackRange = document.createRange()
  const fallbackSelection = window.getSelection()
  const last = parent.lastChild
  if (last && last.nodeType === Node.TEXT_NODE) {
    const len = last.textContent ? last.textContent.length : 0
    fallbackRange.setStart(last, len)
  }
  if (!last || last.nodeType !== Node.TEXT_NODE) {
    fallbackRange.selectNodeContents(parent)
  }
  fallbackRange.collapse(false)
  fallbackSelection?.removeAllRanges()
  fallbackSelection?.addRange(fallbackRange)
}
