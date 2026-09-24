// Vendored from vimtor/opencode-plugins (opencode-quick-quote, MIT). Theme tokens use Shuvcode names.
import { Plugin } from "@opencode/plugin/tui"
import {
  BoxRenderable,
  TextRenderable,
  ScrollBoxRenderable,
  isEditBufferRenderable,
  type EditBufferRenderable,
  type Renderable,
} from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { blockquote, filterParagraphs, paragraphs, quoteTrigger } from "./quick-quote-text"

type Prompt = { readonly sessionID?: string; readonly mode: "normal" | "shell" }

function findEditor(node: Renderable): EditBufferRenderable | undefined {
  if (isEditBufferRenderable(node)) return node
  for (const child of node.getChildren()) {
    const editor = findEditor(child)
    if (editor) return editor
  }
}

function mount(ctx: Plugin.Context, prompt: Prompt) {
  // A zero-size slot marker locates this prompt's editor without capturing a
  // dialog's input or another session's composer when focus changes.
  const marker = new BoxRenderable(ctx.renderer, { width: 0, height: 0, position: "absolute" })
  const popup = new BoxRenderable(ctx.renderer, {
    id: `quick-quote-${marker.num}`,
    position: "absolute",
    visible: false,
    zIndex: 100,
    flexDirection: "column",
    border: ["left", "right"],
    borderColor: ctx.theme.border.base,
    customBorderChars: {
      topLeft: "",
      bottomLeft: "",
      topRight: "",
      bottomRight: "",
      horizontal: " ",
      vertical: "┃",
      bottomT: "",
      topT: "",
      cross: "",
      leftT: "",
      rightT: "",
    },
  })
  const list = new ScrollBoxRenderable(ctx.renderer, {
    width: "100%",
    scrollbarOptions: { visible: false },
    scrollX: false,
    focusable: false,
  })
  popup.add(list)

  let editor: EditBufferRenderable | undefined
  const [target, setTarget] = createSignal<EditBufferRenderable>()
  let anchor: Renderable | undefined
  let source = ""
  let items: string[] = []
  let matches: string[] = []
  let rows: { box: BoxRenderable; label: TextRenderable }[] = []
  let selected = 0
  let activeKey: string | undefined
  let dismissed: string | undefined
  let editing = false
  let disposed = false
  let rowSignature = ""

  function currentTrigger() {
    if (disposed || editing || !editor || editor.isDestroyed || !prompt.sessionID || prompt.mode !== "normal") return
    if (ctx.renderer.currentFocusedEditor !== editor || editor.hasSelection()) return
    const route = ctx.ui.router.current()
    if (route.type !== "session" || route.sessionID !== prompt.sessionID || ctx.keymap.mode.current() !== "base") return
    const before = editor.getTextRange(0, editor.cursorOffset)
    // Completing in the middle of a line would leave part of the query behind.
    const after = editor.plainText.slice(before.length)
    if (after && !after.startsWith("\n")) return
    const trigger = quoteTrigger(before)
    if (trigger?.key === dismissed) return
    return trigger
  }

  function position() {
    if (!popup.visible || !anchor) return
    const available = Math.max(0, anchor.y - ctx.renderer.root.y)
    const height = Math.min(8, Math.max(1, matches.length), available)
    if (height < 1) {
      popup.visible = false
      return
    }
    popup.width = Math.max(1, Math.min(anchor.width, ctx.renderer.width - anchor.x))
    popup.height = height
    popup.left = anchor.x - ctx.renderer.root.x
    popup.top = anchor.y - ctx.renderer.root.y - height
    list.height = height
    if (selected < list.scrollTop) list.scrollTo(selected)
    else if (selected >= list.scrollTop + height) list.scrollTo(selected - height + 1)
  }

  function paint() {
    if (!popup.visible) return
    popup.backgroundColor = ctx.theme.background.raised.high
    popup.borderColor = ctx.theme.border.base
    list.backgroundColor = ctx.theme.background.raised.high
    const signature = JSON.stringify(matches)
    if (signature !== rowSignature || rows.length === 0) {
      rowSignature = signature
      for (const row of rows) row.box.destroyRecursively()
      rows = (matches.length ? matches : ["No matching paragraphs"]).map((text, index) => {
        const box = new BoxRenderable(ctx.renderer, {
          width: "100%",
          height: 1,
          flexShrink: 0,
          paddingLeft: 1,
          paddingRight: 1,
          onMouseMove: () => {
            if (matches.length) {
              selected = index
              paint()
            }
          },
          onMouseDown: (event) => {
            event.preventDefault()
            event.stopPropagation()
          },
          onMouseUp: (event) => {
            event.preventDefault()
            event.stopPropagation()
            if (event.button !== 0 || !matches.length) return
            selected = index
            complete()
          },
        })
        const label = new TextRenderable(ctx.renderer, {
          width: "100%",
          height: 1,
          wrapMode: "none",
          truncate: true,
          selectable: false,
          content: text.replace(/\s+/g, " ").trim(),
        })
        box.add(label)
        list.add(box)
        return { box, label }
      })
    }
    for (const [index, row] of rows.entries()) {
      const focused = matches.length > 0 && index === selected
      row.box.backgroundColor = focused ? ctx.theme.background.action.primary.focused : ctx.theme.background.raised.high
      row.label.fg = focused ? ctx.theme.text.action.primary.focused : ctx.theme.text.base
    }
    position()
  }

  function refresh() {
    if (disposed || editing) return
    const trigger = currentTrigger()
    if (!trigger) {
      activeKey = undefined
      popup.visible = false
      return
    }
    if (activeKey !== trigger.key) {
      selected = 0
      activeKey = trigger.key
      list.scrollTo(0)
    }
    matches = filterParagraphs(items, trigger.query)
    selected = Math.min(selected, Math.max(0, matches.length - 1))
    popup.visible = true
    paint()
  }

  function complete() {
    const trigger = currentTrigger()
    if (!trigger || !editor) return false
    // Recheck the editor synchronously so fast typing cannot insert stale results.
    refresh()
    const paragraph = matches[selected]
    if (paragraph === undefined) return
    const { row, col } = editor.logicalCursor
    editing = true
    try {
      // Keep the existing >: deleting an entire line can also remove its
      // line-start marker in OpenTUI's edit buffer, collapsing a preceding blank.
      editor.deleteRange(row, 1, row, col)
      editor.insertText(blockquote(paragraph).slice(1) + "\n")
    } finally {
      editing = false
    }
    dismissed = undefined
    activeKey = undefined
    popup.visible = false
  }

  function move(delta: number) {
    if (!currentTrigger()) return false
    refresh()
    if (!matches.length) return
    selected = (selected + delta + matches.length) % matches.length
    paint()
  }

  function dismiss() {
    const trigger = currentTrigger()
    if (!trigger) return false
    dismissed = trigger.key
    popup.visible = false
  }

  ctx.keymap.layer(() => ({
    priority: 1000,
    target,
    enabled: () => !!currentTrigger(),
    commands: [
      { id: "quick-quote.previous", title: "Previous quote", bind: "up", run: () => move(-1) },
      { id: "quick-quote.next", title: "Next quote", bind: "down", run: () => move(1) },
      {
        id: "quick-quote.insert",
        title: "Insert quote",
        bind: "return",
        run: (_input, event) => {
          if (!currentTrigger()) return false
          event?.preventDefault()
          event?.stopPropagation()
          return complete()
        },
      },
      { id: "quick-quote.dismiss", title: "Dismiss quotes", bind: "escape", run: dismiss },
    ],
  }))

  function detach() {
    editor?.editBuffer.off("content-changed", refresh)
    editor?.editBuffer.off("cursor-changed", refresh)
    editor = undefined
    setTarget(undefined)
    anchor = undefined
    dismissed = undefined
  }

  function attach() {
    if (disposed) return
    if (!editor || editor.isDestroyed) {
      detach()
      // The nearest shared ancestor is the prompt box. Stop before the app root.
      for (let parent = marker.parent; parent && parent !== ctx.renderer.root; parent = parent.parent) {
        const candidate = findEditor(parent)
        if (!candidate) continue
        editor = candidate
        anchor = parent
        editor.editBuffer.on("content-changed", refresh)
        editor.editBuffer.on("cursor-changed", refresh)
        setTarget(editor)
        break
      }
    }
    refresh()
  }

  createEffect(() => {
    const messages = prompt.sessionID ? ctx.data.session.message.list(prompt.sessionID) : []
    const replies: string[] = []
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]
      // Group replies across background notifications, stopping at their user
      // prompt. While a new prompt is unanswered, keep the last available group.
      if (message.type === "user" && replies.length) break
      if (message.type !== "assistant") continue
      const text = message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n\n")
      if (text.trim()) replies.push(text)
    }
    replies.reverse()
    const signature = JSON.stringify(replies)
    if (signature !== source) {
      source = signature
      items = replies.flatMap(paragraphs)
    }
    refresh()
  })

  onMount(() => {
    ctx.renderer.root.add(popup)
    attach()
    ctx.renderer.on("focused_editor", attach)
    // Also follows layout changes and prompt remounts, like native autocomplete.
    const timer = setInterval(attach, 50)
    onCleanup(() => {
      disposed = true
      clearInterval(timer)
      ctx.renderer.off("focused_editor", attach)
      detach()
      popup.destroyRecursively()
    })
  })
  // Slots accept renderables at runtime; Solid's JSX.Element type only names DOM nodes.
  return marker as unknown as JSX.Element
}

export default Plugin.define({
  id: "shuvcode.quick-quote",
  setup(ctx) {
    return ctx.ui.slot({ append: "prompt.footer", render: (prompt) => mount(ctx, prompt) })
  },
})
