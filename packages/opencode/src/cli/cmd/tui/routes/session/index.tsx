import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  Show,
  Switch,
  useContext,
  type Component,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import path from "path"
import { useRoute, useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { SplitBorder } from "@tui/component/border"
import { useTheme } from "@tui/context/theme"
import {
  BoxRenderable,
  ScrollBoxRenderable,
  addDefaultParsers,
  MacOSScrollAccel,
  RGBA,
  type ScrollAcceleration,
  type ColorInput,
} from "@opentui/core"
import { Prompt, type PromptRef } from "@tui/component/prompt"
import { SearchInput, type SearchInputRef } from "@tui/component/prompt/search"
import type {
  AssistantMessage,
  Part,
  Permission,
  ToolPart,
  UserMessage,
  TextPart,
  ReasoningPart,
  ToolState,
} from "@opencode-ai/sdk/v2"
import { useLocal } from "@tui/context/local"
import { Locale } from "@/util/locale"
import type { Tool } from "@/tool/tool"
import type { ReadTool } from "@/tool/read"
import type { WriteTool } from "@/tool/write"
import { BashTool } from "@/tool/bash"
import type { GlobTool } from "@/tool/glob"
import { TodoWriteTool } from "@/tool/todo"
import type { GrepTool } from "@/tool/grep"
import type { ListTool } from "@/tool/ls"
import type { EditTool } from "@/tool/edit"
import type { PatchTool } from "@/tool/patch"
import type { WebFetchTool } from "@/tool/webfetch"
import type { TaskTool } from "@/tool/task"
import { useKeyboard, useRenderer, useTerminalDimensions, type BoxProps, type JSX } from "@opentui/solid"
import { useSDK } from "@tui/context/sdk"
import { useCommandDialog } from "@tui/component/dialog-command"
import { useKeybind } from "@tui/context/keybind"
import { Header } from "./header"
import { parsePatch } from "diff"
import { useDialog } from "../../ui/dialog"
import { TodoItem } from "../../component/todo-item"
import { DialogMessage } from "./dialog-message"
import type { PromptInfo } from "../../component/prompt/history"
import { iife } from "@/util/iife"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { DialogTimeline } from "./dialog-timeline"
import { DialogForkFromTimeline } from "./dialog-fork-from-timeline"
import { DialogSessionRename } from "../../component/dialog-session-rename"
import { Sidebar } from "./sidebar"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import parsers from "../../../../../../parsers-config.ts"
import { Clipboard } from "../../util/clipboard"
import { Toast, useToast } from "../../ui/toast"
import { useKV } from "../../context/kv.tsx"
import { Editor } from "../../util/editor"
import { PermissionEditor } from "@/permission/editor"
import { Footer } from "./footer.tsx"
import { extend } from "@opentui/solid"
import { GhosttyTerminalRenderable } from "ghostty-opentui/opentui"
import { ptyToText } from "ghostty-opentui"
import stripAnsi from "strip-ansi"
import { usePromptRef } from "../../context/prompt"
import { Filesystem } from "@/util/filesystem"
import { DialogSubagent } from "./dialog-subagent.tsx"
import {
  getSpinnerFrame as _getSpinnerFrame,
  setSpinnerStyle,
  setSpinnerInterval,
  DEFAULT_SPINNER_KEY,
  DEFAULT_SPINNER_INTERVAL_MS,
} from "../../util/spinners"
import { DialogAskQuestion } from "../../ui/dialog-askquestion.tsx"
import { DialogExportOptions } from "../../ui/dialog-export-options"
import type { AskQuestion } from "@/askquestion"

// Re-export for backward compatibility
export { getSpinnerFrame } from "../../util/spinners"

// Local alias
const getSpinnerFrame = _getSpinnerFrame

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    "ghostty-terminal": typeof GhosttyTerminalRenderable
  }
}

addDefaultParsers(parsers.parsers)

extend({ "ghostty-terminal": GhosttyTerminalRenderable })

class CustomSpeedScroll implements ScrollAcceleration {
  constructor(private speed: number) {}

  tick(_now?: number): number {
    return this.speed
  }

  reset(): void {}
}

type BashOutputView = {
  command: string
  output: () => string
}

const context = createContext<{
  width: number
  height: number
  conceal: () => boolean
  showThinking: () => boolean
  showTimestamps: () => boolean
  showTokens: () => boolean
  usernameVisible: () => boolean
  showDetails: () => boolean
  userMessageMarkdown: () => boolean
  diffWrapMode: () => "word" | "none"
  sync: ReturnType<typeof useSync>
  searchQuery: () => string
  currentMatchMessageID: () => string | undefined
  contextLimit: () => number
  bashOutput: () => BashOutputView | undefined
  showBashOutput: (view: BashOutputView | undefined) => void
}>()

function use() {
  const ctx = useContext(context)
  if (!ctx) throw new Error("useContext must be used within a Session component")
  return ctx
}

function HighlightedText(props: { text: string; messageID: string }) {
  const ctx = use()
  const { theme } = useTheme()

  const segments = createMemo(() => {
    const query = ctx.searchQuery().toLowerCase()
    const text = props.text
    if (!query) return [{ text, highlight: false }]

    const result: { text: string; highlight: boolean; isCurrentMatch?: boolean }[] = []
    const lowerText = text.toLowerCase()
    const currentMatchID = ctx.currentMatchMessageID()
    let lastIndex = 0
    let matchIndex = 0

    while (true) {
      const idx = lowerText.indexOf(query, lastIndex)
      if (idx === -1) break

      if (idx > lastIndex) {
        result.push({ text: text.slice(lastIndex, idx), highlight: false })
      }

      const isCurrentMatch = props.messageID === currentMatchID && matchIndex === 0
      result.push({
        text: text.slice(idx, idx + query.length),
        highlight: true,
        isCurrentMatch,
      })
      matchIndex++
      lastIndex = idx + query.length
    }

    if (lastIndex < text.length) {
      result.push({ text: text.slice(lastIndex), highlight: false })
    }

    return result
  })

  return (
    <text fg={theme.text}>
      <For each={segments()}>
        {(segment) => (
          <Show when={segment.highlight} fallback={<>{segment.text}</>}>
            <span
              style={{
                bg: segment.isCurrentMatch ? theme.warning : theme.accent,
                fg: theme.background,
                bold: segment.isCurrentMatch,
              }}
            >
              {segment.text}
            </span>
          </Show>
        )}
      </For>
    </text>
  )
}

export function Session() {
  const route = useRouteData("session")
  const { navigate } = useRoute()
  const sync = useSync()
  const kv = useKV()
  const { theme } = useTheme()
  const promptRef = usePromptRef()
  const session = createMemo(() => sync.session.get(route.sessionID))
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])
  const permissions = createMemo(() => sync.data.permission[route.sessionID] ?? [])

  const pending = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant" && !x.time.completed)?.id
  })

  const lastAssistant = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant")
  })

  const dimensions = useTerminalDimensions()
  const [sidebar, setSidebar] = createSignal<"show" | "hide" | "auto">(kv.get("sidebar", "auto"))

  const hw = 1
  const min = 20
  const max = 80

  function clamp(n: number) {
    return Math.max(min, Math.min(max, n))
  }

  const [w, setW] = createSignal(clamp(kv.get("sidebar_width", 42)))
  const [conceal, setConceal] = createSignal(true)
  const [showThinking, setShowThinking] = createSignal(kv.get("thinking_visibility", true))
  const [showTimestamps, setShowTimestamps] = createSignal(kv.get("timestamps", "hide") === "show")
  const [showTokens, setShowTokens] = createSignal(kv.get("tokens", "hide") === "show")
  const [usernameVisible, setUsernameVisible] = createSignal(kv.get("username_visible", true))
  const [showDetails, setShowDetails] = createSignal(kv.get("tool_details_visibility", true))
  const [showScrollbar, setShowScrollbar] = createSignal(kv.get("scrollbar_visible", false))
  const [headerVisible, setHeaderVisible] = createSignal(kv.get("header_visible", true))
  const [userMessageMarkdown, setUserMessageMarkdown] = createSignal(kv.get("user_message_markdown", true))
  const [diffWrapMode, setDiffWrapMode] = createSignal<"word" | "none">("word")
  const [animationsEnabled, setAnimationsEnabled] = createSignal(kv.get("animations_enabled", true))

  // Initialize spinner style and interval from KV store
  const savedSpinnerStyle = kv.get("spinner_style", DEFAULT_SPINNER_KEY)
  if (savedSpinnerStyle) {
    setSpinnerStyle(savedSpinnerStyle)
  }
  const savedSpinnerInterval = kv.get("spinner_interval", DEFAULT_SPINNER_INTERVAL_MS)
  if (savedSpinnerInterval) {
    setSpinnerInterval(savedSpinnerInterval)
  }

  // Search state
  const [searchMode, setSearchMode] = createSignal(false)
  const [searchQuery, setSearchQuery] = createSignal("")
  const [currentMatchIndex, setCurrentMatchIndex] = createSignal(0)

  // Bash output viewer state
  const [bashOutput, setBashOutput] = createSignal<BashOutputView | undefined>(undefined)

  // Sidebar resize drag state
  const [drag, setDrag] = createSignal(false)
  const [sx, setSx] = createSignal(0)
  const [sw, setSw] = createSignal(0)
  const [hov, setHov] = createSignal(false)

  function save() {
    kv.set("sidebar_width", w())
  }

  function down(x: number) {
    setDrag(true)
    setSx(x)
    setSw(w())
  }

  function move(x: number) {
    if (!drag()) return
    setW(clamp(sw() + (sx() - x)))
  }

  function up() {
    if (!drag()) return
    setDrag(false)
    save()
  }

  // Compute search matches from messages
  const searchMatches = createMemo(() => {
    const query = searchQuery().toLowerCase()
    if (!query) return []

    const matches: { messageID: string; index: number }[] = []
    const msgs = messages()

    for (const msg of msgs) {
      const parts = sync.data.part[msg.id] ?? []
      for (const part of parts) {
        if (part.type === "text" && !part.synthetic) {
          const text = part.text.toLowerCase()
          let startIndex = 0
          let idx: number
          while ((idx = text.indexOf(query, startIndex)) !== -1) {
            matches.push({ messageID: msg.id, index: idx })
            startIndex = idx + 1
          }
        }
      }
    }
    return matches
  })

  const tall = createMemo(() => dimensions().height > 40)
  const wide = createMemo(() => dimensions().width > 120)
  const sidebarVisible = createMemo(() => {
    if (session()?.parentID) return false
    if (sidebar() === "show") return true
    if (sidebar() === "auto" && wide()) return true
    return false
  })
  const sidebarOverlay = createMemo(() => sidebarVisible() && !wide())
  const contentWidth = createMemo(() => dimensions().width - (sidebarVisible() && !sidebarOverlay() ? w() + hw : 0) - 4)

  createEffect(() => !sidebarVisible() && setDrag(false))

  const scrollAcceleration = createMemo(() => {
    const tui = sync.data.config.tui
    if (tui?.scroll_acceleration?.enabled) {
      return new MacOSScrollAccel()
    }
    if (tui?.scroll_speed) {
      return new CustomSpeedScroll(tui.scroll_speed)
    }

    return new CustomSpeedScroll(3)
  })

  createEffect(async () => {
    await sync.session
      .sync(route.sessionID)
      .then(() => {
        if (scroll) scroll.scrollBy(100_000)
      })
      .catch((e) => {
        console.error(e)
        toast.show({
          message: `Session not found: ${route.sessionID}`,
          variant: "error",
        })
        return navigate({ type: "home" })
      })
  })

  const toast = useToast()
  const sdk = useSDK()

  // Handle initial prompt from fork
  createEffect(() => {
    if (route.initialPrompt && prompt) {
      prompt.set(route.initialPrompt)
    }
  })

  // Auto-navigate to whichever session currently needs permission input
  createEffect(() => {
    const currentSession = session()
    if (!currentSession) return
    const currentPermissions = permissions()
    let targetID = currentPermissions.length > 0 ? currentSession.id : undefined

    if (!targetID) {
      const child = sync.data.session.find(
        (x) => x.parentID === currentSession.id && (sync.data.permission[x.id]?.length ?? 0) > 0,
      )
      if (child) targetID = child.id
    }

    if (targetID && targetID !== currentSession.id) {
      navigate({
        type: "session",
        sessionID: targetID,
      })
    }
  })

  // Detect pending askquestion tools from synced message parts
  // Access via session.messages -> parts for proper Solid.js reactivity
  const pendingAskQuestionFromSync = createMemo(() => {
    const sessionMessages = sync.data.message[route.sessionID] ?? []

    // Search backwards for the most recent pending question
    for (const message of [...sessionMessages].reverse()) {
      const parts = sync.data.part[message.id] ?? []

      for (const part of [...parts].reverse()) {
        if (part.type !== "tool") continue
        const toolPart = part as ToolPart

        if (toolPart.tool !== "askquestion") continue
        if (toolPart.state.status !== "running") continue

        const metadata = toolPart.state.metadata as { status?: string; questions?: AskQuestion.Question[] } | undefined

        if (metadata?.status !== "waiting") continue

        return {
          callID: toolPart.callID,
          messageId: toolPart.messageID,
          questions: (metadata.questions ?? []) as AskQuestion.Question[],
        }
      }
    }

    return null
  })

  let scroll: ScrollBoxRenderable
  let bashScroll: ScrollBoxRenderable
  let prompt: PromptRef
  let searchRef: SearchInputRef
  const keybind = useKeybind()

  // Helper: Find next visible message boundary in direction
  const findNextVisibleMessage = (direction: "next" | "prev"): string | null => {
    const children = scroll.getChildren()
    const messagesList = messages()
    const scrollTop = scroll.y

    // Get visible messages sorted by position, filtering for valid non-synthetic, non-ignored content
    const visibleMessages = children
      .filter((c) => {
        if (!c.id) return false
        const message = messagesList.find((m) => m.id === c.id)
        if (!message) return false

        // Check if message has valid non-synthetic, non-ignored text parts
        const parts = sync.data.part[message.id]
        if (!parts || !Array.isArray(parts)) return false

        return parts.some((part) => part && part.type === "text" && !part.synthetic && !part.ignored)
      })
      .sort((a, b) => a.y - b.y)

    if (visibleMessages.length === 0) return null

    if (direction === "next") {
      // Find first message below current position
      return visibleMessages.find((c) => c.y > scrollTop + 10)?.id ?? null
    }
    // Find last message above current position
    return [...visibleMessages].reverse().find((c) => c.y < scrollTop - 10)?.id ?? null
  }

  // Helper: Scroll to message in direction or fallback to page scroll
  const scrollToMessage = (direction: "next" | "prev", dialog: ReturnType<typeof useDialog>) => {
    const targetID = findNextVisibleMessage(direction)

    if (!targetID) {
      scroll.scrollBy(direction === "next" ? scroll.height : -scroll.height)
      dialog.clear()
      return
    }

    const child = scroll.getChildren().find((c) => c.id === targetID)
    if (child) scroll.scrollBy(child.y - scroll.y - 1)
    dialog.clear()
  }

  const renderer = useRenderer()

  async function handleEditPermission(permission: Permission) {
    if (!PermissionEditor.canEdit(permission)) {
      toast.show({ message: "This permission cannot be edited", variant: "error" })
      return
    }

    const content = PermissionEditor.getContent(permission)
    const ext = PermissionEditor.getExtension(permission)
    const line = PermissionEditor.getStartLine(
      permission.metadata.originalContent as string,
      permission.metadata.suggestedContent as string,
    )

    const result = await Editor.open({ value: content, renderer, extension: ext, line })

    if (!result.ok) {
      const message =
        result.reason === "no-editor"
          ? "No editor configured (set EDITOR or VISUAL env var)"
          : "Editor closed without saving"
      toast.show({ message, variant: result.reason === "no-editor" ? "error" : "warning" })
      return
    }

    const edited = result.content

    // Check if user actually made changes
    if (!PermissionEditor.hasChanges(content, edited)) {
      // No changes - treat as normal accept
      sdk.client.permission.respond({
        permissionID: permission.id,
        sessionID: route.sessionID,
        response: "once",
      })
      return
    }

    // Build the modify response
    const modifyData: PermissionEditor.SingleFileModifyData = {
      content: edited,
    }
    sdk.client.permission.respond({
      permissionID: permission.id,
      sessionID: route.sessionID,
      response: "modify",
      modifyData,
    })
  }

  useKeyboard((evt) => {
    if (dialog.stack.length > 0) return

    // Handle bash output viewer keyboard navigation
    if (bashOutput()) {
      const scroll = bashScroll
      const amount = 3
      const pageAmount = Math.max(1, dimensions().height - 4)
      if (evt.name === "escape" || (evt.name === "c" && evt.ctrl)) {
        setBashOutput(undefined)
        evt.preventDefault()
      } else if (evt.name === "up") {
        scroll?.scrollBy(-amount)
        evt.preventDefault()
      } else if (evt.name === "down") {
        scroll?.scrollBy(amount)
        evt.preventDefault()
      } else if (evt.name === "pageup") {
        scroll?.scrollBy(-pageAmount)
        evt.preventDefault()
      } else if (evt.name === "pagedown") {
        scroll?.scrollBy(pageAmount)
        evt.preventDefault()
      } else if (evt.name === "home") {
        scroll?.scrollTo(0)
        evt.preventDefault()
      } else if (evt.name === "end") {
        scroll?.scrollTo(scroll.scrollHeight)
        evt.preventDefault()
      }
      return
    }

    const first = permissions()[0]
    if (first) {
      const editKeybind = sync.data.config.keybinds?.permission_edit ?? "e"
      const response = iife(() => {
        if (evt.ctrl || evt.meta) return
        if (evt.name === "return") return "once"
        if (evt.name === "a") return "always"
        if (evt.name === "d") return "reject"
        if (evt.name === "escape") return "reject"
        if (evt.name === editKeybind && PermissionEditor.isEditable(first)) return "edit"
        return
      })
      if (response === "edit") {
        handleEditPermission(first)
        return
      }
      if (response) {
        sdk.client.permission.respond({
          permissionID: first.id,
          sessionID: route.sessionID,
          response: response,
        })
      }
    }
  })

  function toBottom() {
    setTimeout(() => {
      if (scroll) scroll.scrollTo(scroll.scrollHeight)
    }, 50)
  }

  const local = useLocal()

  const contextLimit = createMemo(() => {
    const c = local.model.current()
    if (!c) return 200000
    const provider = sync.data.provider.find((p) => p.id === c.providerID)
    return provider?.models[c.modelID]?.limit.context ?? 200000
  })

  function moveChild(direction: number) {
    const parentID = session()?.parentID ?? session()?.id
    let children = sync.data.session
      .filter((x) => x.parentID === parentID || x.id === parentID)
      .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    if (children.length === 1) return
    let next = children.findIndex((x) => x.id === session()?.id) + direction
    if (next >= children.length) next = 0
    if (next < 0) next = children.length - 1
    if (children[next]) {
      navigate({
        type: "session",
        sessionID: children[next].id,
      })
    }
  }

  function goToParent() {
    const parentID = session()?.parentID
    if (parentID) {
      navigate({ type: "session", sessionID: parentID })
    }
  }

  // Search navigation functions
  function scrollToMatch(index: number) {
    const matches = searchMatches()
    if (matches.length === 0 || index < 0 || index >= matches.length) return

    const match = matches[index]
    // Use setTimeout to ensure DOM is updated before scrolling
    setTimeout(() => {
      const child = scroll.getChildren().find((c) => c.id === match.messageID)
      if (child) {
        scroll.scrollBy(child.y - scroll.y - 1)
      }
    }, 0)
  }

  function nextMatch() {
    const matches = searchMatches()
    if (matches.length === 0) return

    const nextIndex = (currentMatchIndex() + 1) % matches.length
    setCurrentMatchIndex(nextIndex)
    scrollToMatch(nextIndex)
  }

  function previousMatch() {
    const matches = searchMatches()
    if (matches.length === 0) return

    const prevIndex = (currentMatchIndex() - 1 + matches.length) % matches.length
    setCurrentMatchIndex(prevIndex)
    scrollToMatch(prevIndex)
  }

  function exitSearch() {
    setSearchMode(false)
    setSearchQuery("")
    setCurrentMatchIndex(0)
    prompt?.focus()
  }

  const command = useCommandDialog()
  command.register(() => [
    ...(sync.data.config.share !== "disabled"
      ? [
          {
            title: "Share session",
            value: "session.share",
            suggested: route.type === "session",
            keybind: "session_share" as const,
            disabled: !!session()?.share?.url,
            category: "Session",
            onSelect: async (dialog: any) => {
              dialog.clear()
              try {
                const res = await sdk.client.session.share({
                  sessionID: route.sessionID,
                })
                if (res.data?.share?.url) {
                  await Clipboard.copy(res.data.share.url).catch(() => {})
                  toast.show({ message: "Share URL copied to clipboard!", variant: "success" })
                }
              } catch {
                toast.show({ message: "Failed to share session", variant: "error" })
              }
            },
          },
        ]
      : []),
    {
      title: "Search in messages",
      value: "session.search",
      keybind: "session_search",
      category: "Session",
      onSelect: (dialog) => {
        setSearchMode(true)
        dialog.clear()
      },
    },
    {
      title: "Rename session",
      value: "session.rename",
      keybind: "session_rename",
      category: "Session",
      onSelect: (dialog) => {
        dialog.replace(() => <DialogSessionRename session={route.sessionID} />)
      },
    },
    {
      title: "Jump to message",
      value: "session.timeline",
      keybind: "session_timeline",
      category: "Session",
      onSelect: (dialog) => {
        dialog.replace(() => (
          <DialogTimeline
            onMove={(messageID) => {
              const child = scroll.getChildren().find((child) => {
                return child.id === messageID
              })
              if (child) scroll.scrollBy(child.y - scroll.y - 1)
            }}
            sessionID={route.sessionID}
            setPrompt={(promptInfo) => prompt.set(promptInfo)}
          />
        ))
      },
    },
    {
      title: "Fork from message",
      value: "session.fork",
      keybind: "session_fork",
      category: "Session",
      onSelect: (dialog) => {
        dialog.replace(() => (
          <DialogForkFromTimeline
            onMove={(messageID) => {
              const child = scroll.getChildren().find((child) => {
                return child.id === messageID
              })
              if (child) scroll.scrollBy(child.y - scroll.y - 1)
            }}
            sessionID={route.sessionID}
          />
        ))
      },
    },
    {
      title: "Compact session",
      value: "session.compact",
      keybind: "session_compact",
      category: "Session",
      onSelect: (dialog) => {
        const selectedModel = local.model.current()
        if (!selectedModel) {
          toast.show({
            variant: "warning",
            message: "Connect a provider to summarize this session",
            duration: 3000,
          })
          return
        }
        sdk.client.session.summarize({
          sessionID: route.sessionID,
          modelID: selectedModel.modelID,
          providerID: selectedModel.providerID,
        })
        dialog.clear()
      },
    },
    {
      title: "Unshare session",
      value: "session.unshare",
      keybind: "session_unshare",
      disabled: !session()?.share?.url,
      category: "Session",
      onSelect: async (dialog) => {
        dialog.clear()
        await sdk.client.session
          .unshare({
            sessionID: route.sessionID,
          })
          .then(() => toast.show({ message: "Session unshared", variant: "success" }))
          .catch(() => toast.show({ message: "Failed to unshare session", variant: "error" }))
      },
    },
    {
      title: "Undo previous message",
      value: "session.undo",
      keybind: "messages_undo",
      category: "Session",
      onSelect: async (dialog) => {
        const status = sync.data.session_status?.[route.sessionID]
        if (status?.type !== "idle") await sdk.client.session.abort({ sessionID: route.sessionID }).catch(() => {})
        const revert = session()?.revert?.messageID
        const message = messages().findLast((x) => (!revert || x.id < revert) && x.role === "user")
        if (!message) return
        sdk.client.session
          .revert({
            sessionID: route.sessionID,
            messageID: message.id,
          })
          .then(() => {
            toBottom()
          })
        const parts = sync.data.part[message.id]
        prompt.set(
          parts.reduce(
            (agg, part) => {
              if (part.type === "text") {
                if (!part.synthetic) agg.input += part.text
              }
              if (part.type === "file") agg.parts.push(part)
              return agg
            },
            { input: "", parts: [] as PromptInfo["parts"] },
          ),
        )
        dialog.clear()
      },
    },
    {
      title: "Redo",
      value: "session.redo",
      keybind: "messages_redo",
      disabled: !session()?.revert?.messageID,
      category: "Session",
      onSelect: (dialog) => {
        dialog.clear()
        const messageID = session()?.revert?.messageID
        if (!messageID) return
        const message = messages().find((x) => x.role === "user" && x.id > messageID)
        if (!message) {
          sdk.client.session.unrevert({
            sessionID: route.sessionID,
          })
          prompt.set({ input: "", parts: [] })
          return
        }
        sdk.client.session.revert({
          sessionID: route.sessionID,
          messageID: message.id,
        })
      },
    },
    {
      title: sidebarVisible() ? "Hide sidebar" : "Show sidebar",
      value: "session.sidebar.toggle",
      keybind: "sidebar_toggle",
      category: "Session",
      onSelect: (dialog) => {
        setSidebar((prev) => {
          if (prev === "auto") return sidebarVisible() ? "hide" : "show"
          if (prev === "show") return "hide"
          return "show"
        })
        if (sidebar() === "show") kv.set("sidebar", "auto")
        if (sidebar() === "hide") kv.set("sidebar", "hide")
        dialog.clear()
      },
    },
    {
      title: usernameVisible() ? "Hide username" : "Show username",
      value: "session.username_visible.toggle",
      keybind: "username_toggle",
      category: "Session",
      onSelect: (dialog) => {
        setUsernameVisible((prev) => {
          const next = !prev
          kv.set("username_visible", next)
          return next
        })
        dialog.clear()
      },
    },
    {
      title: "Toggle code concealment",
      value: "session.toggle.conceal",
      keybind: "messages_toggle_conceal" as any,
      category: "Session",
      onSelect: (dialog) => {
        setConceal((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: showTimestamps() ? "Hide timestamps" : "Show timestamps",
      value: "session.toggle.timestamps",
      category: "Session",
      onSelect: (dialog) => {
        setShowTimestamps((prev) => {
          const next = !prev
          kv.set("timestamps", next ? "show" : "hide")
          return next
        })
        dialog.clear()
      },
    },
    {
      title: showThinking() ? "Hide thinking" : "Show thinking",
      value: "session.toggle.thinking",
      category: "Session",
      onSelect: (dialog) => {
        setShowThinking((prev) => {
          const next = !prev
          kv.set("thinking_visibility", next)
          return next
        })
        dialog.clear()
      },
    },
    {
      title: showTokens() ? "Hide tokens" : "Show tokens",
      value: "session.toggle.tokens",
      category: "Session",
      onSelect: (dialog) => {
        setShowTokens((prev) => {
          const next = !prev
          kv.set("tokens", next ? "show" : "hide")
          return next
        })
        dialog.clear()
      },
    },
    {
      title: "Toggle diff wrapping",
      value: "session.toggle.diffwrap",
      category: "Session",
      onSelect: (dialog) => {
        setDiffWrapMode((prev) => (prev === "word" ? "none" : "word"))
        dialog.clear()
      },
    },
    {
      title: showDetails() ? "Hide tool details" : "Show tool details",
      value: "session.toggle.actions",
      keybind: "tool_details",
      category: "Session",
      onSelect: (dialog) => {
        const newValue = !showDetails()
        setShowDetails(newValue)
        kv.set("tool_details_visibility", newValue)
        dialog.clear()
      },
    },
    {
      title: "Toggle session scrollbar",
      value: "session.toggle.scrollbar",
      keybind: "scrollbar_toggle",
      category: "Session",
      onSelect: (dialog) => {
        setShowScrollbar((prev) => {
          const next = !prev
          kv.set("scrollbar_visible", next)
          return next
        })
        dialog.clear()
      },
    },
    {
      title: headerVisible() ? "Hide session header" : "Show session header",
      value: "session.header.toggle",
      keybind: "header_toggle",
      category: "Session",
      onSelect: (dialog) => {
        setHeaderVisible((prev) => {
          const next = !prev
          kv.set("header_visible", next)
          return next
        })
        dialog.clear()
      },
    },
    {
      title: userMessageMarkdown() ? "Disable user message markdown" : "Enable user message markdown",
      value: "session.toggle.user_message_markdown",
      category: "Session",
      onSelect: (dialog) => {
        setUserMessageMarkdown((prev) => {
          const next = !prev
          kv.set("user_message_markdown", next)
          return next
        })
        dialog.clear()
      },
    },
    {
      title: animationsEnabled() ? "Disable animations" : "Enable animations",
      value: "session.toggle.animations",
      category: "Session",
      onSelect: (dialog) => {
        setAnimationsEnabled((prev) => {
          const next = !prev
          kv.set("animations_enabled", next)
          return next
        })
        dialog.clear()
      },
    },
    {
      title: "Page up",
      value: "session.page.up",
      keybind: "messages_page_up",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollBy(-scroll.height / 2)
        dialog.clear()
      },
    },
    {
      title: "Page down",
      value: "session.page.down",
      keybind: "messages_page_down",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollBy(scroll.height / 2)
        dialog.clear()
      },
    },
    {
      title: "Half page up",
      value: "session.half.page.up",
      keybind: "messages_half_page_up",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollBy(-scroll.height / 4)
        dialog.clear()
      },
    },
    {
      title: "Half page down",
      value: "session.half.page.down",
      keybind: "messages_half_page_down",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollBy(scroll.height / 4)
        dialog.clear()
      },
    },
    {
      title: "First message",
      value: "session.first",
      keybind: "messages_first",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollTo(0)
        dialog.clear()
      },
    },
    {
      title: "Last message",
      value: "session.last",
      keybind: "messages_last",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollTo(scroll.scrollHeight)
        dialog.clear()
      },
    },
    {
      title: "Jump to last user message",
      value: "session.messages_last_user",
      keybind: "messages_last_user",
      category: "Session",
      onSelect: () => {
        const messages = sync.data.message[route.sessionID]
        if (!messages || !messages.length) return

        // Find the most recent user message with non-ignored, non-synthetic text parts
        for (let i = messages.length - 1; i >= 0; i--) {
          const message = messages[i]
          if (!message || message.role !== "user") continue

          const parts = sync.data.part[message.id]
          if (!parts || !Array.isArray(parts)) continue

          const hasValidTextPart = parts.some(
            (part) => part && part.type === "text" && !part.synthetic && !part.ignored,
          )

          if (hasValidTextPart) {
            const child = scroll.getChildren().find((child) => {
              return child.id === message.id
            })
            if (child) scroll.scrollBy(child.y - scroll.y - 1)
            break
          }
        }
      },
    },
    {
      title: "Copy last assistant message",
      value: "messages.copy",
      keybind: "messages_copy",
      category: "Session",
      onSelect: (dialog) => {
        const revertID = session()?.revert?.messageID
        const lastAssistantMessage = messages().findLast(
          (msg) => msg.role === "assistant" && (!revertID || msg.id < revertID),
        )
        if (!lastAssistantMessage) {
          toast.show({ message: "No assistant messages found", variant: "error" })
          dialog.clear()
          return
        }

        const parts = sync.data.part[lastAssistantMessage.id] ?? []
        const textParts = parts.filter((part) => part.type === "text")
        if (textParts.length === 0) {
          toast.show({ message: "No text parts found in last assistant message", variant: "error" })
          dialog.clear()
          return
        }

        const text = textParts
          .map((part) => part.text)
          .join("\n")
          .trim()
        if (!text) {
          toast.show({
            message: "No text content found in last assistant message",
            variant: "error",
          })
          dialog.clear()
          return
        }

        const base64 = Buffer.from(text).toString("base64")
        const osc52 = `\x1b]52;c;${base64}\x07`
        const finalOsc52 = process.env["TMUX"] ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52
        /* @ts-expect-error */
        renderer.writeOut(finalOsc52)
        Clipboard.copy(text)
          .then(() => toast.show({ message: "Message copied to clipboard!", variant: "success" }))
          .catch(() => toast.show({ message: "Failed to copy to clipboard", variant: "error" }))
        dialog.clear()
      },
    },
    {
      title: "Copy session transcript",
      value: "session.copy",
      keybind: "session_copy",
      category: "Session",
      onSelect: async (dialog) => {
        try {
          // Format session transcript as markdown
          const sessionData = session()
          if (!sessionData) return
          const sessionMessages = messages()

          let transcript = `# ${sessionData.title}\n\n`
          transcript += `**Session ID:** ${sessionData.id}\n`
          transcript += `**Created:** ${new Date(sessionData.time.created).toLocaleString()}\n`
          transcript += `**Updated:** ${new Date(sessionData.time.updated).toLocaleString()}\n\n`
          transcript += `---\n\n`

          for (const msg of sessionMessages) {
            const parts = sync.data.part[msg.id] ?? []
            const role = msg.role === "user" ? "User" : "Assistant"
            transcript += `## ${role}\n\n`

            for (const part of parts) {
              if (part.type === "text" && !part.synthetic) {
                transcript += `${part.text}\n\n`
              } else if (part.type === "reasoning") {
                if (showThinking()) {
                  transcript += `_Thinking:_\n\n${part.text}\n\n`
                }
              } else if (part.type === "tool") {
                transcript += `\`\`\`\nTool: ${part.tool}\n`
                if (showDetails() && part.state.input) {
                  transcript += `\n**Input:**\n\`\`\`json\n${JSON.stringify(part.state.input, null, 2)}\n\`\`\``
                }
                if (showDetails() && part.state.status === "completed" && part.state.output) {
                  transcript += `\n**Output:**\n\`\`\`\n${part.state.output}\n\`\`\``
                }
                if (showDetails() && part.state.status === "error" && part.state.error) {
                  transcript += `\n**Error:**\n\`\`\`\n${part.state.error}\n\`\`\``
                }
                transcript += `\n\`\`\`\n\n`
              }
            }

            transcript += `---\n\n`
          }

          // Copy to clipboard
          await Clipboard.copy(transcript)
          toast.show({ message: "Session transcript copied to clipboard!", variant: "success" })
        } catch (error) {
          toast.show({ message: "Failed to copy session transcript", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "Export session transcript to file",
      value: "session.export",
      keybind: "session_export",
      category: "Session",
      onSelect: async (dialog) => {
        try {
          // Format session transcript as markdown
          const sessionData = session()
          if (!sessionData) return
          const sessionMessages = messages()

          const defaultFilename = `session-${sessionData.id.slice(0, 8)}.md`

          const options = await DialogExportOptions.show(dialog, defaultFilename, showThinking(), showDetails())

          if (options === null) return

          const { filename: customFilename, thinking: includeThinking, toolDetails: includeToolDetails } = options

          let transcript = `# ${sessionData.title}\n\n`
          transcript += `**Session ID:** ${sessionData.id}\n`
          transcript += `**Created:** ${new Date(sessionData.time.created).toLocaleString()}\n`
          transcript += `**Updated:** ${new Date(sessionData.time.updated).toLocaleString()}\n\n`
          transcript += `---\n\n`

          for (const msg of sessionMessages) {
            const parts = sync.data.part[msg.id] ?? []
            const role = msg.role === "user" ? "User" : "Assistant"
            transcript += `## ${role}\n\n`

            for (const part of parts) {
              if (part.type === "text" && !part.synthetic) {
                transcript += `${part.text}\n\n`
              } else if (part.type === "reasoning") {
                if (includeThinking) {
                  transcript += `_Thinking:_\n\n${part.text}\n\n`
                }
              } else if (part.type === "tool") {
                transcript += `\`\`\`\nTool: ${part.tool}\n`
                if (includeToolDetails && part.state.input) {
                  transcript += `\n**Input:**\n\`\`\`json\n${JSON.stringify(part.state.input, null, 2)}\n\`\`\``
                }
                if (includeToolDetails && part.state.status === "completed" && part.state.output) {
                  transcript += `\n**Output:**\n\`\`\`\n${part.state.output}\n\`\`\``
                }
                if (includeToolDetails && part.state.status === "error" && part.state.error) {
                  transcript += `\n**Error:**\n\`\`\`\n${part.state.error}\n\`\`\``
                }
                transcript += `\n\`\`\`\n\n`
              }
            }

            transcript += `---\n\n`
          }

          // Save to file in current working directory
          const exportDir = process.cwd()
          const filename = customFilename.trim()
          const filepath = path.join(exportDir, filename)

          await Bun.write(filepath, transcript)

          // Open with EDITOR if available
          const result = await Editor.open({ value: transcript, renderer })
          if (result.ok) {
            // User edited the file, save the changes
            await Bun.write(filepath, result.content)
          }

          toast.show({ message: `Session exported to ${filename}`, variant: "success" })
        } catch (error) {
          toast.show({ message: "Failed to export session", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "Next child session",
      value: "session.child.next",
      keybind: "session_child_cycle",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        moveChild(1)
        dialog.clear()
      },
    },
    {
      title: "Previous child session",
      value: "session.child.previous",
      keybind: "session_child_cycle_reverse",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        moveChild(-1)
        dialog.clear()
      },
    },
    {
      title: "Go to parent session",
      value: "session.parent",
      keybind: "session_parent",
      category: "Session",
      disabled: !session()?.parentID,
      onSelect: (dialog) => {
        goToParent()
        dialog.clear()
      },
    },
  ])

  const revertInfo = createMemo(() => session()?.revert)
  const revertMessageID = createMemo(() => revertInfo()?.messageID)

  const revertDiffFiles = createMemo(() => {
    const diffText = revertInfo()?.diff ?? ""
    if (!diffText) return []

    try {
      const patches = parsePatch(diffText)
      return patches.map((patch) => {
        const filename = patch.newFileName || patch.oldFileName || "unknown"
        const cleanFilename = filename.replace(/^[ab]\//, "")
        return {
          filename: cleanFilename,
          additions: patch.hunks.reduce(
            (sum, hunk) => sum + hunk.lines.filter((line) => line.startsWith("+")).length,
            0,
          ),
          deletions: patch.hunks.reduce(
            (sum, hunk) => sum + hunk.lines.filter((line) => line.startsWith("-")).length,
            0,
          ),
        }
      })
    } catch (error) {
      return []
    }
  })

  const revertRevertedMessages = createMemo(() => {
    const messageID = revertMessageID()
    if (!messageID) return []
    return messages().filter((x) => x.id >= messageID && x.role === "user")
  })

  const revert = createMemo(() => {
    const info = revertInfo()
    if (!info) return
    if (!info.messageID) return
    return {
      messageID: info.messageID,
      reverted: revertRevertedMessages(),
      diff: info.diff,
      diffFiles: revertDiffFiles(),
    }
  })

  const dialog = useDialog()

  // snap to bottom when session changes
  createEffect(on(() => route.sessionID, toBottom))

  return (
    <context.Provider
      value={{
        get width() {
          return contentWidth()
        },
        get height() {
          return dimensions().height
        },
        conceal,
        showThinking,
        showTimestamps,
        showTokens,
        usernameVisible,
        showDetails,
        userMessageMarkdown,
        diffWrapMode,
        sync,
        searchQuery,
        contextLimit,
        currentMatchMessageID: () => {
          const matches = searchMatches()
          const idx = currentMatchIndex()
          return matches[idx]?.messageID
        },
        bashOutput,
        showBashOutput: setBashOutput,
      }}
    >
      <box
        flexDirection="row"
        onMouseDrag={(e) => {
          move(e.x)
        }}
        onMouseUp={() => {
          up()
        }}
        onMouseDragEnd={() => {
          up()
        }}
      >
        <box flexGrow={1} paddingBottom={1} paddingTop={1} paddingLeft={2} paddingRight={2} gap={1}>
          <Show
            when={session()}
            fallback={
              <box flexGrow={1} justifyContent="center" alignItems="center" paddingTop={2} paddingLeft={2}>
                <text fg={theme.textMuted}>{getSpinnerFrame()} Loading session...</text>
              </box>
            }
          >
            <Show when={headerVisible() && (!sidebarVisible() || sidebarOverlay())}>
              <Header />
            </Show>
            <Switch>
              <Match when={bashOutput()}>
                {(view) => (
                  <box flexGrow={1} flexDirection="column">
                    <box paddingLeft={1} paddingBottom={1} flexShrink={0}>
                      <text fg={theme.textMuted}>$ {view().command}</text>
                    </box>
                    <scrollbox
                      ref={(r) => (bashScroll = r)}
                      flexGrow={1}
                      paddingLeft={1}
                      paddingBottom={1}
                      scrollAcceleration={scrollAcceleration()}
                    >
                      <ghostty-terminal ansi={view().output()} cols={contentWidth()} />
                    </scrollbox>
                    <Show when={tall()}>
                      <box flexShrink={0} paddingLeft={1}>
                        <text fg={theme.textMuted}>
                          ESC to close | ↑/↓ scroll | PgUp/PgDn page | Home/End top/bottom
                        </text>
                      </box>
                    </Show>
                  </box>
                )}
              </Match>
              <Match when={!bashOutput()}>
                <>
                  <scrollbox
                    ref={(r) => (scroll = r)}
                    verticalScrollbarOptions={{
                      paddingLeft: 1,
                      visible: showScrollbar(),
                      trackOptions: {
                        backgroundColor: theme.backgroundElement,
                        foregroundColor: theme.border,
                      },
                    }}
                    stickyScroll={true}
                    stickyStart="bottom"
                    flexGrow={1}
                    scrollAcceleration={scrollAcceleration()}
                  >
                    <For each={messages()}>
                      {(message, index) => (
                        <box id={message.id}>
                          <Switch>
                            <Match when={message.id === revert()?.messageID}>
                              {(function () {
                                const command = useCommandDialog()
                                const [hover, setHover] = createSignal(false)
                                const dialog = useDialog()

                                const handleUnrevert = async () => {
                                  const confirmed = await DialogConfirm.show(
                                    dialog,
                                    "Confirm Redo",
                                    "Are you sure you want to restore the reverted messages?",
                                  )
                                  if (confirmed) {
                                    command.trigger("session.redo")
                                  }
                                }

                                return (
                                  <box
                                    onMouseOver={() => setHover(true)}
                                    onMouseOut={() => setHover(false)}
                                    onMouseUp={handleUnrevert}
                                    marginTop={1}
                                    flexShrink={0}
                                    border={["left"]}
                                    customBorderChars={SplitBorder.customBorderChars}
                                    borderColor={theme.backgroundPanel}
                                  >
                                    <box
                                      paddingTop={1}
                                      paddingBottom={1}
                                      paddingLeft={2}
                                      backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
                                    >
                                      <text fg={theme.textMuted}>{revert()!.reverted.length} message reverted</text>
                                      <text fg={theme.textMuted}>
                                        <span style={{ fg: theme.text }}>{keybind.print("messages_redo")}</span> or
                                        /redo to restore
                                      </text>
                                      <Show when={revert()!.diffFiles?.length}>
                                        <box marginTop={1}>
                                          <For each={revert()!.diffFiles}>
                                            {(file) => (
                                              <text fg={theme.text}>
                                                {file.filename}
                                                <Show when={file.additions > 0}>
                                                  <span style={{ fg: theme.diffAdded }}> +{file.additions}</span>
                                                </Show>
                                                <Show when={file.deletions > 0}>
                                                  <span style={{ fg: theme.diffRemoved }}> -{file.deletions}</span>
                                                </Show>
                                              </text>
                                            )}
                                          </For>
                                        </box>
                                      </Show>
                                    </box>
                                  </box>
                                )
                              })()}
                            </Match>
                            <Match when={revert()?.messageID && message.id >= revert()!.messageID}>
                              <></>
                            </Match>
                            <Match when={message.role === "user"}>
                              <UserMessage
                                index={index()}
                                onMouseUp={() => {
                                  if (renderer.getSelection()?.getSelectedText()) return
                                  dialog.replace(() => (
                                    <DialogMessage
                                      messageID={message.id}
                                      sessionID={route.sessionID}
                                      setPrompt={(promptInfo) => prompt.set(promptInfo)}
                                    />
                                  ))
                                }}
                                message={message as UserMessage}
                                parts={sync.data.part[message.id] ?? []}
                                pending={pending()}
                              />
                            </Match>
                            <Match when={message.role === "assistant"}>
                              <AssistantMessage
                                last={lastAssistant()?.id === message.id}
                                message={message as AssistantMessage}
                                parts={sync.data.part[message.id] ?? []}
                              />
                            </Match>
                          </Switch>
                        </box>
                      )}
                    </For>
                  </scrollbox>
                  <box flexShrink={0}>
                    <Switch>
                      <Match when={pendingAskQuestionFromSync()}>
                        {(pending) => (
                          <DialogAskQuestion
                            questions={pending().questions}
                            onSubmit={async (answers) => {
                              await fetch(`${sdk.url}/askquestion/respond`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  callID: pending().callID,
                                  sessionID: route.sessionID,
                                  answers,
                                }),
                              }).catch(() => {
                                toast.show({
                                  message: "Failed to submit answers",
                                  variant: "error",
                                })
                              })
                            }}
                            onCancel={async () => {
                              await fetch(`${sdk.url}/askquestion/cancel`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  callID: pending().callID,
                                  sessionID: route.sessionID,
                                }),
                              }).catch(() => {
                                toast.show({
                                  message: "Failed to cancel",
                                  variant: "error",
                                })
                              })
                            }}
                          />
                        )}
                      </Match>
                      <Match when={searchMode()}>
                        <SearchInput
                          ref={(r) => (searchRef = r)}
                          sessionID={route.sessionID}
                          onInput={(query) => {
                            setSearchQuery(query)
                            setCurrentMatchIndex(0)
                            if (query && searchMatches().length > 0) {
                              scrollToMatch(0)
                            }
                          }}
                          onNext={nextMatch}
                          onPrevious={previousMatch}
                          onExit={exitSearch}
                          matchInfo={{
                            current: currentMatchIndex(),
                            total: searchMatches().length,
                          }}
                        />
                      </Match>
                      <Match when={!pendingAskQuestionFromSync() && !searchMode()}>
                        <Prompt
                          ref={(r) => {
                            prompt = r
                            promptRef.set(r)
                          }}
                          disabled={permissions().length > 0}
                          onSubmit={() => {
                            toBottom()
                          }}
                          onSearchToggle={() => {
                            setSearchMode(true)
                          }}
                          sessionID={route.sessionID}
                        />
                      </Match>
                    </Switch>
                  </box>
                  <Show when={(!sidebarVisible() || sidebarOverlay()) && tall()}>
                    <Footer />
                  </Show>
                </>
              </Match>
            </Switch>
          </Show>
          <Toast />
        </box>
        <Show when={sidebarVisible() && !sidebarOverlay()}>
          <>
            <box
              width={hw}
              onMouseOver={() => {
                setHov(true)
              }}
              onMouseOut={() => {
                setHov(false)
              }}
              onMouseDown={(e) => {
                e.preventDefault()
                down(e.x)
              }}
            />
            <Sidebar sessionID={route.sessionID} width={w()} />
          </>
        </Show>
        <Show when={sidebarOverlay()}>
          <box
            position="absolute"
            left={0}
            top={0}
            width={dimensions().width}
            height={dimensions().height}
            backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
            zIndex={100}
            flexDirection="row"
            justifyContent="flex-end"
            onMouseUp={() => setSidebar("hide")}
          >
            <box onMouseUp={(e) => e.stopPropagation()}>
              <Sidebar sessionID={route.sessionID} width={w()} />
            </box>
          </box>
        </Show>
      </box>
    </context.Provider>
  )
}

const MIME_BADGE: Record<string, string> = {
  "text/plain": "txt",
  "image/png": "img",
  "image/jpeg": "img",
  "image/gif": "img",
  "image/webp": "img",
  "application/pdf": "pdf",
  "application/x-directory": "dir",
}

function UserMessage(props: {
  message: UserMessage
  parts: Part[]
  onMouseUp: () => void
  index: number
  pending?: string
}) {
  const ctx = use()
  const local = useLocal()
  const text = createMemo(() => props.parts.flatMap((x) => (x.type === "text" && !x.synthetic ? [x] : []))[0])
  const files = createMemo(() => props.parts.flatMap((x) => (x.type === "file" ? [x] : [])))
  const sync = useSync()
  const { theme, syntax } = useTheme()
  const [hover, setHover] = createSignal(false)
  const queued = createMemo(() => props.pending && props.message.id > props.pending)
  const color = createMemo(() => (queued() ? theme.accent : local.agent.color(props.message.agent)))

  const compaction = createMemo(() => props.parts.find((x) => x.type === "compaction"))

  return (
    <>
      <Show when={text()}>
        <box
          border={["left"]}
          borderColor={color()}
          customBorderChars={SplitBorder.customBorderChars}
          marginTop={props.index === 0 ? 0 : 1}
        >
          <box
            onMouseOver={() => {
              setHover(true)
            }}
            onMouseOut={() => {
              setHover(false)
            }}
            onMouseUp={props.onMouseUp}
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
            flexShrink={0}
          >
            <Show
              when={ctx.searchQuery()}
              fallback={
                <Switch>
                  <Match when={ctx.userMessageMarkdown()}>
                    <code
                      filetype="markdown"
                      drawUnstyledText={false}
                      streaming={false}
                      syntaxStyle={syntax()}
                      content={text()?.text ?? ""}
                      conceal={ctx.conceal()}
                      fg={theme.text}
                    />
                  </Match>
                  <Match when={!ctx.userMessageMarkdown()}>
                    <text fg={theme.text}>{text()?.text}</text>
                  </Match>
                </Switch>
              }
            >
              <HighlightedText text={text()?.text ?? ""} messageID={props.message.id} />
            </Show>
            <Show when={files().length}>
              <box flexDirection="row" paddingBottom={1} paddingTop={1} gap={1} flexWrap="wrap">
                <For each={files()}>
                  {(file) => {
                    const bg = createMemo(() => {
                      if (file.mime.startsWith("image/")) return theme.accent
                      if (file.mime === "application/pdf") return theme.primary
                      return theme.secondary
                    })
                    return (
                      <text fg={theme.text}>
                        <span style={{ bg: bg(), fg: theme.background }}> {MIME_BADGE[file.mime] ?? file.mime} </span>
                        <span style={{ bg: theme.backgroundElement, fg: theme.textMuted }}> {file.filename} </span>
                      </text>
                    )
                  }}
                </For>
              </box>
            </Show>
            <text fg={theme.textMuted}>
              {ctx.usernameVisible() ? `${sync.data.config.username ?? "You "}` : "You "}
              <Show
                when={queued()}
                fallback={
                  <Show when={ctx.showTimestamps()}>
                    <span style={{ fg: theme.textMuted }}>
                      {ctx.usernameVisible() ? " · " : " "}
                      {Locale.todayTimeOrDateTime(props.message.time.created)}
                    </span>
                  </Show>
                }
              >
                <span> </span>
                <span style={{ bg: theme.accent, fg: theme.backgroundPanel, bold: true }}> QUEUED </span>
              </Show>
            </text>
          </box>
        </box>
      </Show>
      <Show when={compaction()}>
        <box
          marginTop={1}
          border={["top"]}
          title=" Compaction "
          titleAlignment="center"
          borderColor={theme.borderActive}
        />
      </Show>
    </>
  )
}

function AssistantMessage(props: { message: AssistantMessage; parts: Part[]; last: boolean }) {
  const ctx = use()
  const local = useLocal()
  const { theme } = useTheme()
  const sync = useSync()
  const messages = createMemo(() => sync.data.message[props.message.sessionID] ?? [])

  const final = createMemo(() => {
    return props.message.finish && !["tool-calls", "unknown"].includes(props.message.finish)
  })

  const duration = createMemo(() => {
    if (!final()) return 0
    if (!props.message.time.completed) return 0
    const user = messages().find((x) => x.role === "user" && x.id === props.message.parentID)
    // Fall back to assistant message creation time for shell commands (where user message is synthetic)
    const startTime = user?.time?.created ?? props.message.time.created
    return props.message.time.completed - startTime
  })

  // Context usage - total tokens used in the context window
  // For shell commands (which have 0 tokens), use the last assistant message with actual token usage
  const contextTokens = createMemo(() => {
    const tokens = props.message.tokens.input + props.message.tokens.cache.read + props.message.tokens.cache.write
    if (tokens > 0) return tokens
    // Fall back to last assistant message with actual tokens (for shell commands)
    const lastWithTokens = messages().findLast(
      (x) => x.role === "assistant" && x.tokens.input + x.tokens.cache.read + x.tokens.cache.write > 0,
    )
    if (lastWithTokens && lastWithTokens.role === "assistant") {
      return lastWithTokens.tokens.input + lastWithTokens.tokens.cache.read + lastWithTokens.tokens.cache.write
    }
    return 0
  })

  const percentage = createMemo(() => {
    const limit = ctx.contextLimit()
    if (!limit) return 0
    return Math.round((contextTokens() / limit) * 100)
  })

  return (
    <>
      <For each={props.parts}>
        {(part, index) => {
          const component = createMemo(() => PART_MAPPING[part.type as keyof typeof PART_MAPPING])
          return (
            <Show when={component()}>
              <Dynamic
                last={index() === props.parts.length - 1}
                component={component()}
                part={part as any}
                message={props.message}
              />
            </Show>
          )
        }}
      </For>
      <Show when={props.message.error}>
        <box
          border={["left"]}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          marginTop={1}
          backgroundColor={theme.backgroundPanel}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={theme.error}
        >
          <text fg={theme.textMuted}>{props.message.error?.data.message}</text>
        </box>
      </Show>
      <Switch>
        <Match when={props.last || final()}>
          <box paddingLeft={3}>
            <text marginTop={1}>
              <span style={{ fg: local.agent.color(props.message.mode) }}>▣ </span>{" "}
              <span style={{ fg: theme.text }}>{Locale.titlecase(props.message.mode)}</span>
              <span style={{ fg: theme.textMuted }}> · {props.message.modelID}</span>
              <Show when={duration()}>
                <span style={{ fg: theme.textMuted }}> · {Locale.duration(duration())}</span>
              </Show>
              <Show when={ctx.showTokens() && contextTokens() > 0}>
                <span style={{ fg: theme.textMuted }}>
                  {" "}
                  · {contextTokens().toLocaleString()} ({percentage()}%)
                </span>
              </Show>
            </text>
          </box>
        </Match>
      </Switch>
    </>
  )
}

const PART_MAPPING = {
  text: TextPart,
  tool: ToolPart,
  reasoning: ReasoningPart,
}

function ReasoningPart(props: { last: boolean; part: ReasoningPart; message: AssistantMessage }) {
  const { theme, subtleSyntax } = useTheme()
  const ctx = use()
  const content = createMemo(() => {
    // Filter out redacted reasoning chunks from OpenRouter
    // OpenRouter sends encrypted reasoning data that appears as [REDACTED]
    return props.part.text.replace("[REDACTED]", "").trim()
  })
  return (
    <Show when={content() && ctx.showThinking()}>
      <box
        id={"text-" + props.part.id}
        paddingLeft={2}
        marginTop={1}
        flexDirection="column"
        border={["left"]}
        customBorderChars={SplitBorder.customBorderChars}
        borderColor={theme.backgroundElement}
      >
        <code
          filetype="markdown"
          drawUnstyledText={false}
          streaming={true}
          syntaxStyle={subtleSyntax()}
          content={"_Thinking:_ " + content()}
          conceal={ctx.conceal()}
          fg={theme.textMuted}
        />
      </box>
    </Show>
  )
}

function TextPart(props: { last: boolean; part: TextPart; message: AssistantMessage }) {
  const ctx = use()
  const { theme, syntax } = useTheme()
  const hasSearchMatch = createMemo(() => {
    const query = ctx.searchQuery().toLowerCase()
    if (!query) return false
    return props.part.text.toLowerCase().includes(query)
  })

  return (
    <Show when={props.part.text.trim()}>
      <box id={"text-" + props.part.id} paddingLeft={3} marginTop={1} flexShrink={0}>
        <Show
          when={hasSearchMatch()}
          fallback={
            <code
              filetype="markdown"
              drawUnstyledText={false}
              streaming={true}
              syntaxStyle={syntax()}
              content={props.part.text.trim()}
              conceal={ctx.conceal()}
              fg={theme.text}
            />
          }
        >
          <HighlightedText text={props.part.text.trim()} messageID={props.message.id} />
        </Show>
      </box>
    </Show>
  )
}

// Pending messages moved to individual tool pending functions

function ToolPart(props: { last: boolean; part: ToolPart; message: AssistantMessage }) {
  const { theme } = useTheme()
  const { showDetails } = use()
  const sync = useSync()
  const local = useLocal()
  const [margin, setMargin] = createSignal(0)
  const component = createMemo(() => {
    // Hide tool if showDetails is false and tool completed successfully
    // But always show if there's an error or permission is required
    const shouldHide =
      !showDetails() &&
      props.part.state.status === "completed" &&
      !sync.data.permission[props.message.sessionID]?.some((x) => x.callID === props.part.callID)

    if (shouldHide) {
      return undefined
    }

    const render = ToolRegistry.render(props.part.tool) ?? GenericTool

    const metadata = props.part.state.status === "pending" ? {} : (props.part.state.metadata ?? {})
    const input = props.part.state.input ?? {}
    const container = ToolRegistry.container(props.part.tool)
    const permissions = sync.data.permission[props.message.sessionID] ?? []
    const permissionIndex = permissions.findIndex((x) => x.callID === props.part.callID)
    const permission = permissions[permissionIndex]

    const style: BoxProps =
      container === "block" || permission
        ? {
            border: permissionIndex === 0 ? (["left", "right"] as const) : (["left"] as const),
            paddingTop: 1,
            paddingBottom: 1,
            paddingLeft: 2,
            marginTop: 1,
            gap: 1,
            backgroundColor: theme.backgroundPanel,
            customBorderChars: SplitBorder.customBorderChars,
            borderColor: permissionIndex === 0 ? theme.warning : theme.background,
          }
        : {
            paddingLeft: 3,
          }

    return (
      <box
        marginTop={margin()}
        {...style}
        renderBefore={function () {
          const el = this as BoxRenderable
          const parent = el.parent
          if (!parent) {
            return
          }
          if (el.height > 1) {
            setMargin(1)
            return
          }
          const children = parent.getChildren()
          const index = children.indexOf(el)
          const previous = children[index - 1]
          if (!previous) {
            setMargin(0)
            return
          }
          if (previous.height > 1 || previous.id.startsWith("text-")) {
            setMargin(1)
            return
          }
        }}
      >
        <Dynamic
          component={render}
          input={input}
          tool={props.part.tool}
          metadata={metadata}
          permission={permission?.metadata ?? {}}
          output={props.part.state.status === "completed" ? props.part.state.output : undefined}
          status={props.part.state.status}
          agentColor={local.agent.color(props.message.mode)}
        />
        {props.part.state.status === "error" && (
          <box paddingLeft={2}>
            <text fg={theme.error}>{props.part.state.error.replace("Error: ", "")}</text>
          </box>
        )}
        {permission && (
          <box gap={1}>
            <text fg={theme.text}>Permission required to run this tool:</text>
            <box flexDirection="row" gap={2}>
              <text fg={theme.text}>
                <b>enter</b>
                <span style={{ fg: theme.textMuted }}> accept</span>
              </text>
              <text fg={theme.text}>
                <b>a</b>
                <span style={{ fg: theme.textMuted }}> accept always</span>
              </text>
              <text fg={theme.text}>
                <b>d</b>
                <span style={{ fg: theme.textMuted }}> deny</span>
              </text>
              {PermissionEditor.isEditable(permission) && (
                <text fg={theme.text}>
                  <b>{sync.data.config.keybinds?.permission_edit ?? "e"}</b>
                  <span style={{ fg: theme.textMuted }}> edit</span>
                </text>
              )}
            </box>
          </box>
        )}
      </box>
    )
  })

  return <Show when={component()}>{component()}</Show>
}

type ToolProps<T extends Tool.Info> = {
  input: Partial<Tool.InferParameters<T>>
  metadata: Partial<Tool.InferMetadata<T>>
  permission: Record<string, any>
  tool: string
  output?: string
  status: ToolState["status"]
  agentColor: ColorInput
}
function GenericTool(props: ToolProps<any>) {
  const isRunning = props.status === "running"
  return (
    <ToolTitle icon="⚙" fallback="Writing command..." when={true} loading={isRunning} loadingColor={props.agentColor}>
      {props.tool} {input(props.input)}
    </ToolTitle>
  )
}

type ToolRegistration<T extends Tool.Info = any> = {
  name: string
  container: "inline" | "block"
  render?: Component<ToolProps<T>>
}
const ToolRegistry = (() => {
  const state: Record<string, ToolRegistration> = {}
  function register<T extends Tool.Info>(input: ToolRegistration<T>) {
    state[input.name] = input
    return input
  }
  return {
    register,
    container(name: string) {
      return state[name]?.container
    },
    render(name: string) {
      return state[name]?.render
    },
  }
})()

function ToolTitle(props: {
  fallback: string
  when: any
  icon: string
  children: JSX.Element
  loading?: boolean
  loadingColor?: ColorInput
}) {
  const { theme } = useTheme()
  return (
    <text paddingLeft={3} fg={props.when ? theme.textMuted : theme.text}>
      <Show fallback={<>~ {props.fallback}</>} when={props.when}>
        <span style={{ bold: true }}>{props.icon}</span>
        <Show when={props.loading}>
          <span style={{ fg: props.loadingColor, bold: true }}> {getSpinnerFrame()}</span>
        </Show>{" "}
        {props.children}
      </Show>
    </text>
  )
}

// Maximum lines for bash output on large terminals
const BASH_MAX_DISPLAY_LINES = 20
// Minimum lines to show even on very small terminals
const BASH_MIN_DISPLAY_LINES = 4

ToolRegistry.register<typeof BashTool>({
  name: "bash",
  container: "block",
  render(props) {
    const rawOutput = createMemo(() => props.metadata.output?.trim() ?? "")
    const ctx = use()
    const { theme } = useTheme()

    // Only show spinner for "running" status
    // "pending" means waiting for input or permission - show fallback text instead
    const isRunning = props.status === "running"

    // Dynamic line limit based on terminal height
    // Reserve lines for: prompt area (~4), header (~2), tool title (~2), command (~1), footer (~2), margins (~3)
    // Total overhead ~14 lines. Use about 40% of remaining height for bash output.
    const displayLines = createMemo(() => {
      const terminalHeight = ctx.height
      const availableHeight = Math.max(0, terminalHeight - 14)
      const targetLines = Math.floor(availableHeight * 0.4)
      return Math.max(BASH_MIN_DISPLAY_LINES, Math.min(BASH_MAX_DISPLAY_LINES, targetLines))
    })

    // For line counting and truncation detection, use plain text
    const plainOutput = createMemo(() => ptyToText(stripAnsi(rawOutput()), { rows: 120, cols: 256 }))

    const displayOutput = createMemo(() => {
      const lines = rawOutput().split("\n")
      const limit = displayLines()
      if (lines.length <= limit) return rawOutput()
      return lines.slice(0, limit).join("\n") + `\n... (${lines.length - limit} more lines)`
    })

    const truncated = createMemo(() => plainOutput().split("\n").length > displayLines())

    return (
      <box>
        <ToolTitle icon="#" fallback="Writing command..." when={props.input.command}>
          {props.input.description || "Shell"}
        </ToolTitle>
        <Show when={props.input.command}>
          <text fg={theme.text}>$ {props.input.command}</text>
        </Show>
        <Show when={displayOutput() && ctx.width > 0}>
          {/* Render ANSI output via Ghostty terminal emulation.
              Keep rows==limit so layout height stays accurate. */}
          <ghostty-terminal
            ansi={displayOutput()}
            rows={displayLines()}
            limit={displayLines()}
            trimEnd
            cols={Math.max(ctx.width, 40)}
          />
        </Show>
        <Show when={truncated()}>
          <box
            onMouseUp={() => {
              ctx.showBashOutput({ command: props.input.command!, output: rawOutput })
            }}
          >
            <text fg={theme.textMuted}>Click to view full output</text>
          </box>
        </Show>
        {/* Show spinner at bottom of output when running - ensures visibility even when output is truncated */}
        <Show when={isRunning}>
          <text fg={props.agentColor} paddingLeft={3} paddingTop={-5} paddingBottom={-5}>
            {getSpinnerFrame()}
          </text>
        </Show>
      </box>
    )
  },
})

ToolRegistry.register<typeof ReadTool>({
  name: "read",
  container: "inline",
  render(props) {
    const isRunning = props.status === "running"
    return (
      <>
        <ToolTitle
          icon="→"
          fallback="Reading file..."
          when={props.input.filePath}
          loading={isRunning}
          loadingColor={props.agentColor}
        >
          Read {normalizePath(props.input.filePath!)} {input(props.input, ["filePath"])}
        </ToolTitle>
      </>
    )
  },
})

ToolRegistry.register<typeof WriteTool>({
  name: "write",
  container: "block",
  render(props) {
    const { theme, syntax } = useTheme()
    const isRunning = props.status === "running"
    const code = createMemo(() => {
      if (!props.input.content) return ""
      return props.input.content
    })

    const diagnostics = createMemo(() => {
      const filePath = Filesystem.normalizePath(props.input.filePath ?? "")
      return props.metadata.diagnostics?.[filePath] ?? []
    })

    const done = !!props.input.filePath

    return (
      <>
        <ToolTitle
          icon="←"
          fallback="Preparing write..."
          when={done}
          loading={isRunning}
          loadingColor={props.agentColor}
        >
          Wrote {props.input.filePath}
        </ToolTitle>
        <Show when={done}>
          <line_number fg={theme.textMuted} minWidth={3} paddingRight={1}>
            <code
              conceal={false}
              fg={theme.text}
              filetype={filetype(props.input.filePath!)}
              syntaxStyle={syntax()}
              content={code()}
            />
          </line_number>
        </Show>
        <Show when={diagnostics().length}>
          <For each={diagnostics()}>
            {(diagnostic) => (
              <text fg={theme.error}>
                Error [{diagnostic.range.start.line}:{diagnostic.range.start.character}]: {diagnostic.message}
              </text>
            )}
          </For>
        </Show>
      </>
    )
  },
})

ToolRegistry.register<typeof GlobTool>({
  name: "glob",
  container: "inline",
  render(props) {
    const isRunning = props.status === "running"
    return (
      <>
        <ToolTitle
          icon="✱"
          fallback="Finding files..."
          when={props.input.pattern}
          loading={isRunning}
          loadingColor={props.agentColor}
        >
          Glob "{props.input.pattern}" <Show when={props.input.path}>in {normalizePath(props.input.path)} </Show>
          <Show when={props.metadata.count}>({props.metadata.count} matches)</Show>
        </ToolTitle>
      </>
    )
  },
})

ToolRegistry.register<typeof GrepTool>({
  name: "grep",
  container: "inline",
  render(props) {
    const isRunning = props.status === "running"
    return (
      <ToolTitle
        icon="✱"
        fallback="Searching content..."
        when={props.input.pattern}
        loading={isRunning}
        loadingColor={props.agentColor}
      >
        Grep "{props.input.pattern}" <Show when={props.input.path}>in {normalizePath(props.input.path)} </Show>
        <Show when={props.metadata.matches}>({props.metadata.matches} matches)</Show>
      </ToolTitle>
    )
  },
})

ToolRegistry.register<typeof ListTool>({
  name: "list",
  container: "inline",
  render(props) {
    const isRunning = props.status === "running"
    const dir = createMemo(() => {
      if (props.input.path) {
        return normalizePath(props.input.path)
      }
      return ""
    })
    return (
      <>
        <ToolTitle
          icon="→"
          fallback="Listing directory..."
          when={props.input.path !== undefined}
          loading={isRunning}
          loadingColor={props.agentColor}
        >
          List {dir()}
        </ToolTitle>
      </>
    )
  },
})

ToolRegistry.register<typeof TaskTool>({
  name: "task",
  container: "inline",
  render(props) {
    const { theme } = useTheme()
    const keybind = useKeybind()
    const dialog = useDialog()
    const renderer = useRenderer()
    const [hover, setHover] = createSignal(false)
    const isRunning = props.status === "running"

    return (
      <box
        border={["left"]}
        customBorderChars={SplitBorder.customBorderChars}
        borderColor={theme.background}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        marginTop={1}
        gap={1}
        backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
        onMouseOver={() => setHover(true)}
        onMouseOut={() => setHover(false)}
        onMouseUp={() => {
          const id = props.metadata.sessionId
          if (renderer.getSelection()?.getSelectedText() || !id) return
          dialog.replace(() => <DialogSubagent sessionID={id} />)
        }}
      >
        <ToolTitle
          icon="◉"
          fallback="Delegating..."
          when={props.input.subagent_type ?? props.input.description}
          loading={isRunning}
          loadingColor={props.agentColor}
        >
          {Locale.titlecase(props.input.subagent_type ?? "unknown")} Task "{props.input.description}"
        </ToolTitle>
        <Show when={props.metadata.summary?.length}>
          <box>
            <For each={props.metadata.summary ?? []}>
              {(task, index) => {
                const summary = props.metadata.summary ?? []
                return (
                  <text style={{ fg: task.state.status === "error" ? theme.error : theme.textMuted }}>
                    {index() === summary.length - 1 ? "└" : "├"} {Locale.titlecase(task.tool)}{" "}
                    {task.state.status === "completed" ? task.state.title : ""}
                  </text>
                )
              }}
            </For>
          </box>
        </Show>
        <text fg={theme.text}>
          {keybind.print("session_child_cycle")}
          <span style={{ fg: theme.textMuted }}> view subagents</span>
        </text>
      </box>
    )
  },
})

ToolRegistry.register<typeof WebFetchTool>({
  name: "webfetch",
  container: "inline",
  render(props) {
    const isRunning = props.status === "running"
    return (
      <ToolTitle
        icon="%"
        fallback="Fetching from the web..."
        when={(props.input as any).url}
        loading={isRunning}
        loadingColor={props.agentColor}
      >
        WebFetch {(props.input as any).url}
      </ToolTitle>
    )
  },
})

ToolRegistry.register({
  name: "codesearch",
  container: "inline",
  render(props: ToolProps<any>) {
    const input = props.input as any
    const metadata = props.metadata as any
    const isRunning = props.status === "running"
    return (
      <ToolTitle
        icon="◇"
        fallback="Searching code..."
        when={input.query}
        loading={isRunning}
        loadingColor={props.agentColor}
      >
        Exa Code Search "{input.query}" <Show when={metadata.results}>({metadata.results} results)</Show>
      </ToolTitle>
    )
  },
})

ToolRegistry.register({
  name: "websearch",
  container: "inline",
  render(props: ToolProps<any>) {
    const input = props.input as any
    const metadata = props.metadata as any
    const isRunning = props.status === "running"
    return (
      <ToolTitle
        icon="◈"
        fallback="Searching web..."
        when={input.query}
        loading={isRunning}
        loadingColor={props.agentColor}
      >
        Exa Web Search "{input.query}" <Show when={metadata.numResults}>({metadata.numResults} results)</Show>
      </ToolTitle>
    )
  },
})

ToolRegistry.register<typeof EditTool>({
  name: "edit",
  container: "block",
  render(props) {
    const ctx = use()
    const { theme, syntax } = useTheme()
    const isRunning = props.status === "running"

    const view = createMemo(() => {
      const diffStyle = ctx.sync.data.config.tui?.diff_style
      if (diffStyle === "stacked") return "unified"
      // Default to "auto" behavior
      return ctx.width > 120 ? "split" : "unified"
    })

    const ft = createMemo(() => filetype(props.input.filePath))

    const diffContent = createMemo(() => {
      // First check completed metadata
      if (props.metadata.diff) return props.metadata.diff
      // Then check pending permission metadata - compute diff from suggestedContent
      const m = props.permission
      if (m?.originalContent !== undefined && m?.suggestedContent !== undefined && m?.filePath) {
        return PermissionEditor.computeDiff(m.filePath, m.originalContent, m.suggestedContent)
      }
      return undefined
    })

    const diagnostics = createMemo(() => {
      const filePath = Filesystem.normalizePath(props.input.filePath ?? "")
      const arr = props.metadata.diagnostics?.[filePath] ?? []
      return arr.filter((x) => x.severity === 1).slice(0, 3)
    })

    return (
      <>
        <ToolTitle
          icon="←"
          fallback="Preparing edit..."
          when={props.input.filePath}
          loading={isRunning}
          loadingColor={props.agentColor}
        >
          Edit {normalizePath(props.input.filePath!)}{" "}
          {input({
            replaceAll: props.input.replaceAll,
          })}
        </ToolTitle>
        <Show when={diffContent()}>
          <box paddingLeft={1}>
            <diff
              diff={diffContent()}
              view={view()}
              filetype={ft()}
              syntaxStyle={syntax()}
              showLineNumbers={true}
              width="100%"
              wrapMode={ctx.diffWrapMode()}
              fg={theme.text}
              addedBg={theme.diffAddedBg}
              removedBg={theme.diffRemovedBg}
              contextBg={theme.diffContextBg}
              addedSignColor={theme.diffHighlightAdded}
              removedSignColor={theme.diffHighlightRemoved}
              lineNumberFg={theme.diffLineNumber}
              lineNumberBg={theme.diffContextBg}
              addedLineNumberBg={theme.diffAddedLineNumberBg}
              removedLineNumberBg={theme.diffRemovedLineNumberBg}
            />
          </box>
        </Show>
        <Show when={diagnostics().length}>
          <box>
            <For each={diagnostics()}>
              {(diagnostic) => (
                <text fg={theme.error}>
                  Error [{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}] {diagnostic.message}
                </text>
              )}
            </For>
          </box>
        </Show>
      </>
    )
  },
})

ToolRegistry.register<typeof PatchTool>({
  name: "patch",
  container: "block",
  render(props) {
    const { theme } = useTheme()
    const isRunning = props.status === "running"
    return (
      <>
        <ToolTitle
          icon="%"
          fallback="Preparing patch..."
          when={true}
          loading={isRunning}
          loadingColor={props.agentColor}
        >
          Patch
        </ToolTitle>
        <Show when={props.output}>
          <box>
            <text fg={theme.text}>{props.output?.trim()}</text>
          </box>
        </Show>
      </>
    )
  },
})

ToolRegistry.register<typeof TodoWriteTool>({
  name: "todowrite",
  container: "block",
  render(props) {
    const { theme } = useTheme()
    const isRunning = props.status === "running"
    return (
      <>
        <Show when={!props.input.todos?.length}>
          <ToolTitle
            icon="⚙"
            fallback="Updating todos..."
            when={true}
            loading={isRunning}
            loadingColor={props.agentColor}
          >
            Updating todos...
          </ToolTitle>
        </Show>
        <Show when={props.metadata.todos?.length}>
          <box>
            <For each={props.input.todos ?? []}>
              {(todo) => <TodoItem status={todo.status} content={todo.content} />}
            </For>
          </box>
        </Show>
      </>
    )
  },
})

function normalizePath(input?: string) {
  if (!input) return ""
  if (path.isAbsolute(input)) {
    return path.relative(process.cwd(), input) || "."
  }
  return input
}

function input(input: Record<string, any>, omit?: string[]): string {
  const primitives = Object.entries(input).filter(([key, value]) => {
    if (omit?.includes(key)) return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  if (primitives.length === 0) return ""
  return `[${primitives.map(([key, value]) => `${key}=${value}`).join(", ")}]`
}

function filetype(input?: string) {
  if (!input) return "none"
  const ext = path.extname(input)
  const language = LANGUAGE_EXTENSIONS[ext]
  if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
  return language
}
