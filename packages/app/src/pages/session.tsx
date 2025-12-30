import {
  For,
  onCleanup,
  onMount,
  Show,
  Match,
  Switch,
  createResource,
  createMemo,
  createEffect,
  on,
  createRenderEffect,
  batch,
} from "solid-js"
import { Dynamic, Portal } from "solid-js/web"
import { useLocal, type LocalFile } from "@/context/local"
import { createStore } from "solid-js/store"
import { PromptInput } from "@/components/prompt-input"
import { DateTime } from "luxon"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { DiffChanges } from "@opencode-ai/ui/diff-changes"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Tabs } from "@opencode-ai/ui/tabs"
import { useCodeComponent } from "@opencode-ai/ui/context/code"
import { SessionTurn } from "@opencode-ai/ui/session-turn"
import { SessionMessageRail } from "@opencode-ai/ui/session-message-rail"
import { SessionReview } from "@opencode-ai/ui/session-review"
import { showToast } from "@opencode-ai/ui/toast"
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  closestCenter,
  createSortable,
} from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import type { JSX } from "solid-js"
import { useSync } from "@/context/sync"
import { useTerminal, type LocalPTY } from "@/context/terminal"
import { useLayout } from "@/context/layout"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { Terminal } from "@/components/terminal"
import { checksum } from "@opencode-ai/util/encode"
import { useKeyboardVisibility } from "@/hooks/use-keyboard-visibility"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogSelectFile } from "@/components/dialog-select-file"
import { DialogSelectModel } from "@/components/dialog-select-model"
import { DialogSessionRename } from "@/components/dialog-session-rename"
import { DialogSelectMcp } from "@/components/dialog-select-mcp"
import { useCommand } from "@/context/command"
import { useNavigate, useParams } from "@solidjs/router"
import { UserMessage, ToolPart } from "@opencode-ai/sdk/v2"
import { useSDK } from "@/context/sdk"
import { usePrompt } from "@/context/prompt"
import { extractPromptFromParts } from "@/utils/prompt"
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"
import { AskQuestionWizard, type AskQuestionQuestion, type AskQuestionAnswer } from "@/components/askquestion-wizard"
import { StatusBar } from "@/components/status-bar"
import { SessionMcpIndicator } from "@/components/session-mcp-indicator"
import { SessionLspIndicator } from "@/components/session-lsp-indicator"
import { usePermission } from "@/context/permission"

function same<T>(a: readonly T[], b: readonly T[]) {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((x, i) => x === b[i])
}

export default function Page() {
  const layout = useLayout()
  const local = useLocal()
  const sync = useSync()
  const terminal = useTerminal()
  const dialog = useDialog()
  const codeComponent = useCodeComponent()
  const command = useCommand()
  const params = useParams()
  const navigate = useNavigate()
  const sdk = useSDK()
  const prompt = usePrompt()

  // Initialize keyboard visibility tracking for mobile terminal support
  useKeyboardVisibility()

  const permission = usePermission()
  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const tabs = createMemo(() => layout.tabs(sessionKey()))

  const info = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))
  const revertMessageID = createMemo(() => info()?.revert?.messageID)
  const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))
  const emptyUserMessages: UserMessage[] = []
  const userMessages = createMemo(
    () => messages().filter((m) => m.role === "user") as UserMessage[],
    emptyUserMessages,
    { equals: same },
  )
  // Visible user messages excludes reverted messages (those >= revertMessageID)
  const visibleUserMessages = createMemo(
    () => {
      const revert = revertMessageID()
      if (!revert) return userMessages()
      return userMessages().filter((m) => m.id < revert)
    },
    emptyUserMessages,
    { equals: same },
  )
  const lastUserMessage = createMemo(() => visibleUserMessages().at(-1))

  createEffect(
    on(
      () => lastUserMessage()?.id,
      () => {
        const msg = lastUserMessage()
        if (!msg) return
        if (msg.agent) local.agent.set(msg.agent)
        if (msg.model) local.model.set(msg.model)
      },
    ),
  )

  const [messageStore, setMessageStore] = createStore<{ messageId?: string }>({})

  const activeMessage = createMemo(() => {
    if (!messageStore.messageId) return lastUserMessage()
    // If the stored message is no longer visible (e.g., was reverted), fall back to last visible
    const found = visibleUserMessages()?.find((m) => m.id === messageStore.messageId)
    return found ?? lastUserMessage()
  })
  const setActiveMessage = (message: UserMessage | undefined) => {
    setMessageStore("messageId", message?.id)
  }

  function navigateMessageByOffset(offset: number) {
    const msgs = visibleUserMessages()
    if (msgs.length === 0) return

    const current = activeMessage()
    const currentIndex = current ? msgs.findIndex((m) => m.id === current.id) : -1

    let targetIndex: number
    if (currentIndex === -1) {
      targetIndex = offset > 0 ? 0 : msgs.length - 1
    } else {
      targetIndex = currentIndex + offset
    }

    if (targetIndex < 0 || targetIndex >= msgs.length) return

    setActiveMessage(msgs[targetIndex])
  }

  const diffs = createMemo(() => (params.id ? (sync.data.session_diff[params.id] ?? []) : []))

  // Detect pending askquestion tools from synced message parts
  // Matches TUI detection logic at packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:398-427
  const pendingAskQuestion = createMemo(() => {
    const sessionID = params.id
    if (!sessionID) return null

    const sessionMessages = sync.data.message[sessionID] ?? []

    // Search backwards for the most recent pending question
    for (const message of [...sessionMessages].reverse()) {
      const parts = sync.data.part[message.id] ?? []

      for (const part of [...parts].reverse()) {
        if (part.type !== "tool") continue
        const toolPart = part as ToolPart

        if (toolPart.tool !== "askquestion") continue
        if (toolPart.state.status !== "running") continue

        const metadata = toolPart.state.metadata as
          | { status?: string; questions?: AskQuestionQuestion[] }
          | undefined

        if (metadata?.status !== "waiting") continue

        // Ensure questions array exists and is not empty
        const questions = (metadata.questions ?? []) as AskQuestionQuestion[]
        if (questions.length === 0) continue

        return {
          callID: toolPart.callID,
          messageID: toolPart.messageID,
          questions,
        }
      }
    }

    return null
  })

  const [store, setStore] = createStore({
    clickTimer: undefined as number | undefined,
    activeDraggable: undefined as string | undefined,
    activeTerminalDraggable: undefined as string | undefined,
    userInteracted: false,
    stepsExpanded: true,
    mobileTabsOpen: false,
    mobileTerminalFullscreen: false,
    diffSplit: false,
  })
  let inputRef!: HTMLDivElement

  createEffect(() => {
    if (!params.id) return
    sync.session.sync(params.id)
  })

  // Register mobile review button in header when there are tabs/diffs
  createEffect(() => {
    const hasTabs = showTabs()
    const filesCount = info()?.summary?.files ?? diffs().length
    if (hasTabs) {
      layout.mobileReview.register(filesCount, () => setStore("mobileTabsOpen", true))
    } else {
      layout.mobileReview.unregister()
    }
  })

  onCleanup(() => {
    layout.mobileReview.unregister()
  })

  // Register mobile message navigation in header when there are multiple messages
  createEffect(() => {
    const messages = visibleUserMessages()
    if (messages.length > 1) {
      const currentIndex = messages.findIndex((m) => m.id === activeMessage()?.id)
      layout.mobileMessageNav.register(
        messages.map((m) => ({ id: m.id, title: m.summary?.title })),
        currentIndex >= 0 ? currentIndex : 0,
        (index) => setActiveMessage(messages[index]),
      )
    } else {
      layout.mobileMessageNav.unregister()
    }
  })

  onCleanup(() => {
    layout.mobileMessageNav.unregister()
  })

  createEffect(() => {
    if (layout.terminal.opened()) {
      if (terminal.all().length === 0) {
        terminal.new()
      }
    }
  })

  createEffect(
    on(
      () => visibleUserMessages().at(-1)?.id,
      (lastId, prevLastId) => {
        if (lastId && prevLastId && lastId > prevLastId) {
          setMessageStore("messageId", undefined)
        }
      },
      { defer: true },
    ),
  )

  const idle = { type: "idle" as const }

  createEffect(
    on(
      () => params.id,
      (id) => {
        const status = sync.data.session_status[id ?? ""] ?? idle
        batch(() => {
          setStore("userInteracted", false)
          setStore("stepsExpanded", status.type !== "idle")
        })
      },
    ),
  )

  const status = createMemo(() => sync.data.session_status[params.id ?? ""] ?? idle)

  createEffect(
    on(
      () => status().type,
      (type) => {
        if (type !== "idle") return
        batch(() => {
          setStore("userInteracted", false)
          setStore("stepsExpanded", false)
        })
      },
      { defer: true },
    ),
  )

  const working = createMemo(() => status().type !== "idle" && activeMessage()?.id === lastUserMessage()?.id)

  createRenderEffect((prev) => {
    const isWorking = working()
    if (!prev && isWorking) {
      setStore("stepsExpanded", true)
    }
    if (prev && !isWorking && !store.userInteracted) {
      setStore("stepsExpanded", false)
    }
    return isWorking
  }, working())

  command.register(() => [
    {
      id: "session.new",
      title: "New session",
      description: "Create a new session",
      category: "Session",
      keybind: "mod+shift+s",
      slash: "new",
      onSelect: () => navigate(`/${params.dir}/session`),
    },
    {
      id: "file.open",
      title: "Open file",
      description: "Search and open a file",
      category: "File",
      keybind: "mod+p",
      slash: "open",
      onSelect: () => dialog.show(() => <DialogSelectFile />),
    },
    {
      id: "terminal.toggle",
      title: "Toggle terminal",
      description: "Show or hide the terminal",
      category: "View",
      keybind: "ctrl+`",
      slash: "terminal",
      onSelect: () => layout.terminal.toggle(),
    },
    {
      id: "terminal.new",
      title: "New terminal",
      description: "Create a new terminal tab",
      category: "Terminal",
      keybind: "ctrl+shift+`",
      onSelect: () => terminal.new(),
    },
    {
      id: "review.toggle",
      title: "Toggle review",
      description: "Show or hide the review panel",
      category: "View",
      keybind: "mod+shift+r",
      onSelect: () => layout.review.toggle(),
    },
    {
      id: "steps.toggle",
      title: "Toggle steps",
      description: "Show or hide the steps",
      category: "View",
      keybind: "mod+e",
      slash: "steps",
      disabled: !params.id,
      onSelect: () => setStore("stepsExpanded", (x) => !x),
    },
    {
      id: "message.previous",
      title: "Previous message",
      description: "Go to the previous user message",
      category: "Session",
      keybind: "mod+arrowup",
      disabled: !params.id,
      onSelect: () => navigateMessageByOffset(-1),
    },
    {
      id: "message.next",
      title: "Next message",
      description: "Go to the next user message",
      category: "Session",
      keybind: "mod+arrowdown",
      disabled: !params.id,
      onSelect: () => navigateMessageByOffset(1),
    },
    {
      id: "model.choose",
      title: "Choose model",
      description: "Select a different model",
      category: "Model",
      keybind: "mod+'",
      slash: "model",
      onSelect: () => dialog.show(() => <DialogSelectModel />),
    },
    {
      id: "mcp.toggle",
      title: "Toggle MCPs",
      description: "Toggle MCPs",
      category: "MCP",
      keybind: "mod+;",
      slash: "mcp",
      onSelect: () => dialog.show(() => <DialogSelectMcp />),
    },
    {
      id: "agent.cycle",
      title: "Cycle agent",
      description: "Switch to the next agent",
      category: "Agent",
      keybind: "mod+.",
      slash: "agent",
      onSelect: () => local.agent.move(1),
    },
    {
      id: "agent.cycle.reverse",
      title: "Cycle agent backwards",
      description: "Switch to the previous agent",
      category: "Agent",
      keybind: "shift+mod+.",
      onSelect: () => local.agent.move(-1),
    },
    {
      id: "permissions.autoaccept",
      title: params.id && permission.isAutoAccepting(params.id) ? "Stop auto-accepting edits" : "Auto-accept edits",
      category: "Permissions",
      disabled: !params.id,
      onSelect: () => {
        if (!params.id) return
        permission.toggleAutoAccept(params.id)
        showToast({
          title: permission.isAutoAccepting(params.id) ? "Auto-accepting edits" : "Stopped auto-accepting edits",
          description: permission.isAutoAccepting(params.id)
            ? "Edit and write permissions will be automatically approved"
            : "Edit and write permissions will require approval",
        })
      },
    },
    {
      id: "session.undo",
      title: "Undo",
      description: "Undo the last message",
      category: "Session",
      slash: "undo",
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: async () => {
        const sessionID = params.id
        if (!sessionID) return
        if (status()?.type !== "idle") {
          await sdk.client.session.abort({ sessionID }).catch(() => {})
        }
        const revert = info()?.revert?.messageID
        // Find the last user message that's not already reverted
        const message = userMessages().findLast((x) => !revert || x.id < revert)
        if (!message) return
        await sdk.client.session.revert({ sessionID, messageID: message.id })
        // Restore the prompt from the reverted message
        const parts = sync.data.part[message.id]
        if (parts) {
          const restored = extractPromptFromParts(parts)
          prompt.set(restored)
        }
        // Navigate to the message before the reverted one (which will be the new last visible message)
        const priorMessage = userMessages().findLast((x) => x.id < message.id)
        setActiveMessage(priorMessage)
      },
    },
    {
      id: "session.redo",
      title: "Redo",
      description: "Redo the last undone message",
      category: "Session",
      slash: "redo",
      disabled: !params.id || !info()?.revert?.messageID,
      onSelect: async () => {
        const sessionID = params.id
        if (!sessionID) return
        const revertMessageID = info()?.revert?.messageID
        if (!revertMessageID) return
        const nextMessage = userMessages().find((x) => x.id > revertMessageID)
        if (!nextMessage) {
          // Full unrevert - restore all messages and navigate to last
          await sdk.client.session.unrevert({ sessionID })
          prompt.reset()
          // Navigate to the last message (the one that was at the revert point)
          const lastMsg = userMessages().findLast((x) => x.id >= revertMessageID)
          setActiveMessage(lastMsg)
          return
        }
        // Partial redo - move forward to next message
        await sdk.client.session.revert({ sessionID, messageID: nextMessage.id })
        // Navigate to the message before the new revert point
        const priorMsg = userMessages().findLast((x) => x.id < nextMessage.id)
        setActiveMessage(priorMsg)
      },
    },
    {
      id: "session.share",
      title: "Share session",
      description: "Create a shareable link for the session",
      category: "Session",
      slash: "share",
      disabled: !params.id || !!info()?.share?.url || sync.data.config.share === "disabled",
      onSelect: async () => {
        if (!params.id) return
        try {
          const res = await sdk.client.session.share({ sessionID: params.id })
          if (res.data?.share?.url) {
            await navigator.clipboard.writeText(res.data.share.url)
            showToast({ title: "Share URL copied to clipboard!", variant: "success" })
          }
        } catch {
          showToast({ title: "Failed to share session", variant: "error" })
        }
      },
    },
    {
      id: "session.unshare",
      title: "Unshare session",
      description: "Remove the shareable link",
      category: "Session",
      slash: "unshare",
      disabled: !params.id || !info()?.share?.url,
      onSelect: async () => {
        if (!params.id) return
        try {
          await sdk.client.session.unshare({ sessionID: params.id })
          showToast({ title: "Session unshared", variant: "success" })
        } catch {
          showToast({ title: "Failed to unshare session", variant: "error" })
        }
      },
    },
    {
      id: "session.rename",
      title: "Rename session",
      description: "Rename the current session",
      category: "Session",
      keybind: "mod+shift+r",
      slash: "rename",
      disabled: !params.id,
      onSelect: () => {
        if (!params.id) return
        dialog.show(() => <DialogSessionRename sessionID={params.id!} />)
      },
    },
  ])

  const handleKeyDown = (event: KeyboardEvent) => {
    const activeElement = document.activeElement as HTMLElement | undefined
    if (activeElement) {
      const isProtected = activeElement.closest("[data-prevent-autofocus]")
      const isInput = /^(INPUT|TEXTAREA|SELECT)$/.test(activeElement.tagName) || activeElement.isContentEditable
      if (isProtected || isInput) return
    }
    if (dialog.active) return

    if (activeElement === inputRef) {
      if (event.key === "Escape") inputRef?.blur()
      return
    }

    if (event.key.length === 1 && event.key !== "Unidentified" && !(event.ctrlKey || event.metaKey)) {
      inputRef?.focus()
    }
  }

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown)
  })

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown)
  })

  // AskQuestion handlers
  const handleAskQuestionSubmit = async (answers: AskQuestionAnswer[]) => {
    const pending = pendingAskQuestion()
    if (!pending || !params.id) return

    try {
      await fetch(`${sdk.url}/askquestion/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callID: pending.callID,
          sessionID: params.id,
          answers,
        }),
      })
    } catch {
      showToast({ title: "Failed to submit answers", variant: "error" })
    }
  }

  const handleAskQuestionCancel = async () => {
    const pending = pendingAskQuestion()
    if (!pending || !params.id) return

    try {
      await fetch(`${sdk.url}/askquestion/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callID: pending.callID,
          sessionID: params.id,
        }),
      })
    } catch {
      showToast({ title: "Failed to cancel", variant: "error" })
    }
  }

  const resetClickTimer = () => {
    if (!store.clickTimer) return
    clearTimeout(store.clickTimer)
    setStore("clickTimer", undefined)
  }

  const startClickTimer = () => {
    const newClickTimer = setTimeout(() => {
      setStore("clickTimer", undefined)
    }, 300)
    setStore("clickTimer", newClickTimer as unknown as number)
  }

  const handleTabClick = async (tab: string) => {
    if (store.clickTimer) {
      resetClickTimer()
    } else {
      if (tab.startsWith("file://")) {
        local.file.open(tab.replace("file://", ""))
      }
      startClickTimer()
    }
  }

  const handleDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeDraggable", id)
  }

  const handleDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (draggable && droppable) {
      const currentTabs = tabs().all()
      const fromIndex = currentTabs?.indexOf(draggable.id.toString())
      const toIndex = currentTabs?.indexOf(droppable.id.toString())
      if (fromIndex !== toIndex && toIndex !== undefined) {
        tabs().move(draggable.id.toString(), toIndex)
      }
    }
  }

  const handleDragEnd = () => {
    setStore("activeDraggable", undefined)
  }

  const handleTerminalDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeTerminalDraggable", id)
  }

  const handleTerminalDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (draggable && droppable) {
      const terminals = terminal.all()
      const fromIndex = terminals.findIndex((t: LocalPTY) => t.id === draggable.id.toString())
      const toIndex = terminals.findIndex((t: LocalPTY) => t.id === droppable.id.toString())
      if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
        terminal.move(draggable.id.toString(), toIndex)
      }
    }
  }

  const handleTerminalDragEnd = () => {
    setStore("activeTerminalDraggable", undefined)
  }

  const SortableTerminalTab = (props: { terminal: LocalPTY }): JSX.Element => {
    const sortable = createSortable(props.terminal.id)
    return (
      // @ts-ignore
      <div use:sortable classList={{ "h-full": true, "opacity-0": sortable.isActiveDraggable }}>
        <div class="relative h-full">
          <Tabs.Trigger
            value={props.terminal.id}
            closeButton={
              terminal.all().length > 1 && (
                <IconButton icon="close" variant="ghost" onClick={() => terminal.close(props.terminal.id)} />
              )
            }
          >
            {props.terminal.title}
          </Tabs.Trigger>
        </div>
      </div>
    )
  }

  const FileVisual = (props: { file: LocalFile; active?: boolean }): JSX.Element => {
    return (
      <div class="flex items-center gap-x-1.5">
        <FileIcon
          node={props.file}
          classList={{
            "grayscale-100 group-data-[selected]/tab:grayscale-0": !props.active,
            "grayscale-0": props.active,
          }}
        />
        <span
          classList={{
            "text-14-medium": true,
            "text-primary": !!props.file.status?.status,
            italic: !props.file.pinned,
          }}
        >
          {props.file.name}
        </span>
        <span class="hidden opacity-70">
          <Switch>
            <Match when={props.file.status?.status === "modified"}>
              <span class="text-primary">M</span>
            </Match>
            <Match when={props.file.status?.status === "added"}>
              <span class="text-success">A</span>
            </Match>
            <Match when={props.file.status?.status === "deleted"}>
              <span class="text-error">D</span>
            </Match>
          </Switch>
        </span>
      </div>
    )
  }

  const SortableTab = (props: {
    tab: string
    onTabClick: (tab: string) => void
    onTabClose: (tab: string) => void
  }): JSX.Element => {
    const sortable = createSortable(props.tab)
    const [file] = createResource(
      () => props.tab,
      async (tab) => {
        if (tab.startsWith("file://")) {
          return local.file.node(tab.replace("file://", ""))
        }
        return undefined
      },
    )
    return (
      // @ts-ignore
      <div use:sortable classList={{ "h-full": true, "opacity-0": sortable.isActiveDraggable }}>
        <div class="relative h-full">
          <Tabs.Trigger
            value={props.tab}
            closeButton={
              <Tooltip value="Close tab" placement="bottom">
                <IconButton icon="close" variant="ghost" onClick={() => props.onTabClose(props.tab)} />
              </Tooltip>
            }
            hideCloseButton
            onClick={() => props.onTabClick(props.tab)}
          >
            <Switch>
              <Match when={file()}>{(f) => <FileVisual file={f()} />}</Match>
            </Switch>
          </Tabs.Trigger>
        </div>
      </div>
    )
  }

  const showTabs = createMemo(() => layout.review.opened() && (diffs().length > 0 || tabs().all().length > 0))
  const tabsValue = createMemo(() => tabs().active() ?? "review")

  return (
    <div class="relative bg-background-base size-full overflow-hidden flex flex-col">
      <div class="min-h-0 grow w-full flex overflow-hidden">
        {/* Session pane - always visible, full width on mobile */}
        <div
          class="@container relative shrink min-w-0 py-3 flex flex-col gap-6 min-h-0 h-full bg-background-stronger max-sm:!w-full"
          style={{ width: showTabs() ? `min(${layout.session.width()}px, calc(100% - 320px))` : "100%" }}
        >
          <div class="flex-1 min-h-0 overflow-hidden">
            <Switch>
              <Match when={params.id}>
                <div class="flex items-start justify-start h-full min-h-0">
                  <SessionMessageRail
                    class="hidden sm:flex"
                    messages={visibleUserMessages()}
                    current={activeMessage()}
                    onMessageSelect={setActiveMessage}
                    wide={!showTabs()}
                  />
                  <Show when={activeMessage()}>
                    <SessionTurn
                      sessionID={params.id!}
                      messageID={activeMessage()!.id}
                      stepsExpanded={store.stepsExpanded}
                      onStepsExpandedToggle={() => setStore("stepsExpanded", (x) => !x)}
                      onUserInteracted={() => setStore("userInteracted", true)}
                      classes={{
                        root: "pb-20 flex-1 min-w-0 h-full overflow-hidden",
                        content: "pb-20 select-text",
                        container:
                          "w-full " +
                          (!showTabs()
                            ? "max-w-200 mx-auto px-6"
                            : visibleUserMessages().length > 1
                              ? "pr-6 pl-6 sm:pl-2"
                              : "px-6"),
                      }}
                    />
                  </Show>
                </div>
              </Match>
              <Match when={true}>
                <div class="size-full flex flex-col pb-45 justify-end items-start gap-4 flex-[1_0_0] self-stretch max-w-200 mx-auto px-6">
                  <div class="text-20-medium text-text-weaker">New session</div>
                  <div class="flex justify-center items-center gap-3">
                    <Icon name="folder" size="small" />
                    <div class="text-12-medium text-text-weak">
                      {getDirectory(sync.data.path.directory)}
                      <span class="text-text-strong">{getFilename(sync.data.path.directory)}</span>
                    </div>
                  </div>
                  <Show when={sync.project}>
                    {(project) => (
                      <div class="flex justify-center items-center gap-3">
                        <Icon name="pencil-line" size="small" />
                        <div class="text-12-medium text-text-weak">
                          Last modified&nbsp;
                          <span class="text-text-strong">
                            {DateTime.fromMillis(project().time.updated ?? project().time.created).toRelative()}
                          </span>
                        </div>
                      </div>
                    )}
                  </Show>
                </div>
              </Match>
            </Switch>
          </div>
          <div
            class="absolute inset-x-0 flex flex-col justify-center items-center z-50"
            style={{ bottom: "calc(2rem + var(--safe-area-inset-bottom))" }}
          >
            <div
              classList={{
                "w-full px-6": true,
                "max-w-200": !showTabs(),
              }}
            >
              <Switch>
                <Match when={pendingAskQuestion()}>
                  {(pending) => (
                    <AskQuestionWizard
                      questions={pending().questions}
                      onSubmit={handleAskQuestionSubmit}
                      onCancel={handleAskQuestionCancel}
                    />
                  )}
                </Match>
                <Match when={true}>
                  <PromptInput
                    ref={(el) => {
                      inputRef = el
                    }}
                  />
                </Match>
              </Switch>
            </div>
          </div>
          <Show when={showTabs()}>
            <ResizeHandle
              direction="horizontal"
              size={layout.session.width()}
              min={320}
              max={window.innerWidth * 0.7}
              onResize={layout.session.resize}
            />
          </Show>
        </div>

        {/* Tabs pane - visible when there are diffs or file tabs, hidden on mobile */}
        <Show when={showTabs()}>
          <div class="relative flex-1 min-w-0 h-full border-l border-border-weak-base hidden sm:block">
            <DragDropProvider
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
              collisionDetector={closestCenter}
            >
              <DragDropSensors />
              <ConstrainDragYAxis />
              <Tabs value={tabsValue()} onChange={tabs().open}>
                <div class="sticky top-0 shrink-0 flex">
                  <Tabs.List>
                    <Show when={diffs().length}>
                      <Tabs.Trigger value="review">
                        <div class="flex items-center gap-3">
                          <Show when={diffs()}>
                            <DiffChanges changes={diffs()} variant="bars" />
                          </Show>
                          <div class="flex items-center gap-1.5">
                            <div>Review</div>
                            <Show when={info()?.summary?.files}>
                              <div class="text-12-medium text-text-strong h-4 px-2 flex flex-col items-center justify-center rounded-full bg-surface-base">
                                {info()?.summary?.files ?? 0}
                              </div>
                            </Show>
                          </div>
                        </div>
                      </Tabs.Trigger>
                    </Show>
                    <SortableProvider ids={tabs().all() ?? []}>
                      <For each={tabs().all() ?? []}>
                        {(tab) => <SortableTab tab={tab} onTabClick={handleTabClick} onTabClose={tabs().close} />}
                      </For>
                    </SortableProvider>
                    <div class="bg-background-base h-full flex items-center justify-center border-b border-border-weak-base px-3">
                      <Tooltip
                        value={
                          <div class="flex items-center gap-2">
                            <span>Open file</span>
                            <span class="text-icon-base text-12-medium">{command.keybind("file.open")}</span>
                          </div>
                        }
                        class="flex items-center"
                      >
                        <IconButton
                          icon="plus-small"
                          variant="ghost"
                          iconSize="large"
                          onClick={() => dialog.show(() => <DialogSelectFile />)}
                        />
                      </Tooltip>
                    </div>
                  </Tabs.List>
                </div>
                <Show when={diffs().length}>
                  <Tabs.Content value="review" class="select-text flex flex-col h-full overflow-hidden contain-strict">
                    <div class="relative pt-3 flex-1 min-h-0 overflow-hidden">
                      <SessionReview
                        classes={{
                          root: "pb-40",
                          header: "px-6",
                          container: "px-6",
                        }}
                        diffs={diffs()}
                        split={store.diffSplit}
                        actions={
                          <Button
                            size="normal"
                            icon={store.diffSplit ? "layout-right" : "task"}
                            onClick={() => setStore("diffSplit", (x) => !x)}
                          >
                            {store.diffSplit ? "Inline" : "Split"}
                          </Button>
                        }
                      />
                    </div>
                  </Tabs.Content>
                </Show>
                <For each={tabs().all()}>
                  {(tab) => {
                    const [file] = createResource(
                      () => tab,
                      async (tab) => {
                        if (tab.startsWith("file://")) {
                          return local.file.node(tab.replace("file://", ""))
                        }
                        return undefined
                      },
                    )
                    return (
                      <Tabs.Content value={tab} class="select-text flex flex-col h-full overflow-hidden contain-strict">
                        <Show when={file()?.content} keyed>
                          {(content) => {
                            const f = file()!
                            const isPreviewableImage =
                              content.encoding === "base64" &&
                              content.mimeType?.startsWith("image/") &&
                              content.mimeType !== "image/svg+xml"
                            return (
                              <Switch>
                                <Match when={isPreviewableImage}>
                                  <div class="flex-1 min-h-0 overflow-auto flex items-center justify-center p-4 pb-40">
                                    <img
                                      src={`data:${content.mimeType};base64,${content.content}`}
                                      alt={f.path}
                                      class="max-w-full max-h-full object-contain shadow-lg rounded-sm"
                                    />
                                  </div>
                                </Match>
                                <Match when={true}>
                                  <div class="relative pt-3 flex-1 min-h-0 overflow-auto">
                                    <Dynamic
                                      component={codeComponent}
                                      file={{
                                        name: f.path,
                                        contents: content.content ?? "",
                                        cacheKey: checksum(content.content ?? ""),
                                      }}
                                      overflow="scroll"
                                      class="pb-40"
                                    />
                                  </div>
                                </Match>
                              </Switch>
                            )
                          }}
                        </Show>
                      </Tabs.Content>
                    )
                  }}
                </For>
              </Tabs>
              <DragOverlay>
                <Show when={store.activeDraggable}>
                  {(draggedFile) => {
                    const [file] = createResource(
                      () => draggedFile(),
                      async (tab) => {
                        if (tab.startsWith("file://")) {
                          return local.file.node(tab.replace("file://", ""))
                        }
                        return undefined
                      },
                    )
                    return (
                      <div class="relative px-6 h-12 flex items-center bg-background-stronger border-x border-border-weak-base border-b border-b-transparent">
                        <Show when={file()}>{(f) => <FileVisual active file={f()} />}</Show>
                      </div>
                    )
                  }}
                </Show>
              </DragOverlay>
            </DragDropProvider>
          </div>
        </Show>
      </div>
      <Show when={layout.terminal.opened()}>
        <div
          class="relative w-full flex flex-col shrink-0 border-t border-border-weak-base"
          style={{ height: `${layout.terminal.height()}px` }}
        >
          <ResizeHandle
            direction="vertical"
            size={layout.terminal.height()}
            min={100}
            max={window.innerHeight * 0.6}
            collapseThreshold={50}
            onResize={layout.terminal.resize}
            onCollapse={layout.terminal.close}
          />
          <DragDropProvider
            onDragStart={handleTerminalDragStart}
            onDragEnd={handleTerminalDragEnd}
            onDragOver={handleTerminalDragOver}
            collisionDetector={closestCenter}
          >
            <DragDropSensors />
            <ConstrainDragYAxis />
            <Tabs variant="alt" value={terminal.active()} onChange={terminal.open}>
              <div class="flex h-10">
                <Tabs.List class="h-10 flex-1 min-w-0 overflow-x-auto">
                  <SortableProvider ids={terminal.all().map((t: LocalPTY) => t.id)}>
                    <For each={terminal.all()}>{(pty) => <SortableTerminalTab terminal={pty} />}</For>
                  </SortableProvider>
                  <div class="h-full flex items-center justify-center">
                    <Tooltip
                      value={
                        <div class="flex items-center gap-2">
                          <span>New terminal</span>
                          <span class="text-icon-base text-12-medium">{command.keybind("terminal.new")}</span>
                        </div>
                      }
                      class="flex items-center"
                    >
                      <IconButton icon="plus-small" variant="ghost" iconSize="large" onClick={terminal.new} />
                    </Tooltip>
                  </div>
                </Tabs.List>
                <div class="sm:hidden h-full flex items-center justify-center shrink-0 px-2 border-l border-border-weak-base">
                  <Tooltip value="Fullscreen terminal" class="flex items-center">
                    <IconButton
                      icon="expand"
                      variant="ghost"
                      iconSize="small"
                      onClick={() => setStore("mobileTerminalFullscreen", true)}
                    />
                  </Tooltip>
                </div>
              </div>
              <For each={terminal.all()}>
                {(pty) => (
                  <Tabs.Content value={pty.id}>
                    <Terminal pty={pty} onCleanup={terminal.update} onConnectError={() => terminal.clone(pty.id)} />
                  </Tabs.Content>
                )}
              </For>
            </Tabs>
            <DragOverlay>
              <Show when={store.activeTerminalDraggable}>
                {(draggedId) => {
                  const pty = createMemo(() => terminal.all().find((t: LocalPTY) => t.id === draggedId()))
                  return (
                    <Show when={pty()}>
                      {(t) => (
                        <div class="relative p-1 h-10 flex items-center bg-background-stronger text-14-regular">
                          {t().title}
                        </div>
                      )}
                    </Show>
                  )
                }}
              </Show>
            </DragOverlay>
          </DragDropProvider>
        </div>
      </Show>

      {/* Mobile tabs - Portal to escape contain-strict on main element */}
      <Portal>
        {/* Mobile tabs fullscreen overlay */}
        <Show when={store.mobileTabsOpen}>
          <div
            class="fixed inset-0 z-50 sm:hidden flex flex-col bg-background-base"
            style={{
              "padding-top": "var(--safe-area-inset-top)",
              "padding-bottom": "var(--safe-area-inset-bottom)",
              "padding-left": "var(--safe-area-inset-left)",
              "padding-right": "var(--safe-area-inset-right)",
            }}
          >
            {/* Mobile tabs header */}
            <div class="h-12 shrink-0 border-b border-border-weak-base flex items-center justify-between px-4">
              <div class="flex items-center gap-3">
                <Show when={diffs().length > 0}>
                  <DiffChanges changes={diffs()} variant="bars" />
                </Show>
                <span class="text-14-medium text-text-strong">{diffs().length > 0 ? "Review Changes" : "Files"}</span>
                <Show when={info()?.summary?.files}>
                  <div class="text-12-medium text-text-strong h-5 px-2 flex items-center justify-center rounded-full bg-surface-base">
                    {info()?.summary?.files ?? 0}
                  </div>
                </Show>
              </div>
              <IconButton
                icon="close"
                variant="ghost"
                iconSize="large"
                onClick={() => setStore("mobileTabsOpen", false)}
                aria-label="Close"
              />
            </div>

            {/* Mobile tabs content */}
            <div class="flex-1 min-h-0 overflow-hidden">
              <Tabs value={tabsValue()} onChange={tabs().open}>
                <div class="shrink-0 flex border-b border-border-weak-base overflow-x-auto">
                  <Tabs.List>
                    <Show when={diffs().length}>
                      <Tabs.Trigger value="review">
                        <div class="flex items-center gap-2">
                          <div>Review</div>
                          <Show when={info()?.summary?.files}>
                            <div class="text-12-medium text-text-strong h-4 px-2 flex items-center justify-center rounded-full bg-surface-base">
                              {info()?.summary?.files ?? 0}
                            </div>
                          </Show>
                        </div>
                      </Tabs.Trigger>
                    </Show>
                    <For each={tabs().all() ?? []}>
                      {(tab) => {
                        const fileName = () => {
                          if (tab.startsWith("file://")) {
                            return getFilename(tab.replace("file://", ""))
                          }
                          return tab
                        }
                        return (
                          <Tabs.Trigger value={tab} class="max-w-40 truncate">
                            <div class="flex items-center gap-2">
                              <FileIcon node={{ path: tab, type: "file" }} />
                              <span class="truncate">{fileName()}</span>
                            </div>
                          </Tabs.Trigger>
                        )
                      }}
                    </For>
                  </Tabs.List>
                  <div class="flex items-center justify-center px-2">
                    <IconButton
                      icon="plus-small"
                      variant="ghost"
                      iconSize="large"
                      onClick={() => {
                        setStore("mobileTabsOpen", false)
                        dialog.show(() => <DialogSelectFile />)
                      }}
                      aria-label="Open file"
                    />
                  </div>
                </div>
                <Show when={diffs().length}>
                  <Tabs.Content value="review" class="select-text flex flex-col h-full overflow-hidden">
                    <div class="relative flex-1 min-h-0 overflow-auto">
                      <SessionReview
                        classes={{
                          root: "pb-20 pt-3",
                          header: "px-4",
                          container: "px-4",
                        }}
                        diffs={diffs()}
                        split={store.diffSplit}
                        actions={
                          <Button
                            size="normal"
                            icon={store.diffSplit ? "layout-right" : "task"}
                            onClick={() => setStore("diffSplit", (x) => !x)}
                          >
                            {store.diffSplit ? "Inline" : "Split"}
                          </Button>
                        }
                      />
                    </div>
                  </Tabs.Content>
                </Show>
                <For each={tabs().all()}>
                  {(tab) => {
                    const [file] = createResource(
                      () => tab,
                      async (tab) => {
                        if (tab.startsWith("file://")) {
                          return local.file.node(tab.replace("file://", ""))
                        }
                        return undefined
                      },
                    )
                    return (
                      <Tabs.Content value={tab} class="select-text flex flex-col h-full overflow-hidden">
                        <Show when={file()?.content} keyed>
                          {(content) => {
                            const f = file()!
                            const isPreviewableImage =
                              content.encoding === "base64" &&
                              content.mimeType?.startsWith("image/") &&
                              content.mimeType !== "image/svg+xml"
                            return (
                              <Switch>
                                <Match when={isPreviewableImage}>
                                  <div class="flex-1 min-h-0 overflow-auto flex items-center justify-center p-4 pb-20">
                                    <img
                                      src={`data:${content.mimeType};base64,${content.content}`}
                                      alt={f.path}
                                      class="max-w-full max-h-full object-contain shadow-lg rounded-sm"
                                    />
                                  </div>
                                </Match>
                                <Match when={true}>
                                  <div class="relative pt-3 flex-1 min-h-0 overflow-auto">
                                    <Dynamic
                                      component={codeComponent}
                                      file={{
                                        name: f.path,
                                        contents: content.content ?? "",
                                        cacheKey: checksum(content.content ?? ""),
                                      }}
                                      overflow="scroll"
                                      class="pb-20"
                                    />
                                  </div>
                                </Match>
                              </Switch>
                            )
                          }}
                        </Show>
                      </Tabs.Content>
                    )
                  }}
                </For>
              </Tabs>
            </div>
          </div>
        </Show>

        {/* Mobile terminal fullscreen overlay */}
        <Show when={store.mobileTerminalFullscreen}>
          <div
            data-component="mobile-terminal-fullscreen"
            class="fixed inset-0 z-50 sm:hidden flex flex-col bg-background-base"
            style={{
              "padding-top": "var(--safe-area-inset-top)",
              "padding-bottom": "calc(var(--safe-area-inset-bottom) + var(--keyboard-offset, 0px))",
              "padding-left": "var(--safe-area-inset-left)",
              "padding-right": "var(--safe-area-inset-right)",
            }}
          >
            <div class="flex-1 min-h-0 overflow-hidden flex flex-col">
              <Tabs variant="alt" value={terminal.active()} onChange={terminal.open} class="flex flex-col h-full">
                <div class="shrink-0 flex h-10">
                  <Tabs.List class="flex-1 min-w-0 overflow-x-auto">
                    <For each={terminal.all()}>
                      {(pty) => (
                        <Tabs.Trigger value={pty.id} class="max-w-40 truncate">
                          {pty.title}
                        </Tabs.Trigger>
                      )}
                    </For>
                    <div class="h-full flex items-center justify-center">
                      <IconButton
                        icon="plus-small"
                        variant="ghost"
                        iconSize="large"
                        onClick={terminal.new}
                        aria-label="New terminal"
                      />
                    </div>
                  </Tabs.List>
                  <div class="h-full flex items-center justify-center shrink-0 px-2 border-l border-border-weak-base">
                    <Tooltip value="Exit fullscreen" class="flex items-center">
                      <IconButton
                        icon="collapse"
                        variant="ghost"
                        iconSize="small"
                        onClick={() => setStore("mobileTerminalFullscreen", false)}
                        aria-label="Exit fullscreen"
                      />
                    </Tooltip>
                  </div>
                </div>
                <For each={terminal.all()}>
                  {(pty) => (
                    <Tabs.Content value={pty.id} class="flex-1 min-h-0">
                      <Terminal pty={pty} onCleanup={terminal.update} onConnectError={() => terminal.clone(pty.id)} />
                    </Tabs.Content>
                  )}
                </For>
              </Tabs>
            </div>
          </div>
        </Show>
      </Portal>
      <StatusBar>
        <SessionLspIndicator />
        <SessionMcpIndicator />
      </StatusBar>
    </div>
  )
}
