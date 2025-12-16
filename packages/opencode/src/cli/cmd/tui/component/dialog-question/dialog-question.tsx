import { ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { For, Show, Switch, Match, createEffect, createMemo, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useDialog } from "@tui/ui/dialog"
import type { Question } from "@/question"
import { DialogQuestionSelect } from "./dialog-question-select"
import { DialogQuestionMultiSelect } from "./dialog-question-multi-select"
import { DialogQuestionConfirm } from "./dialog-question-confirm"
import { DialogQuestionText } from "./dialog-question-text"

export interface DialogQuestionProps {
  request: Question.Request
  onSubmit: (answers: Question.Answer[]) => void
  onCancel: () => void
}

export function DialogQuestion(props: DialogQuestionProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const fg = selectedForeground(theme)

  // Initialize answers with default values
  const initialAnswers: Record<string, unknown> = {}
  for (const q of props.request.questions) {
    if (q.type === "select" && q.defaultValue) {
      initialAnswers[q.id] = q.defaultValue
    } else if (q.type === "multi-select" && q.defaultValue) {
      initialAnswers[q.id] = q.defaultValue
    } else if (q.type === "confirm" && q.defaultValue !== undefined) {
      initialAnswers[q.id] = q.defaultValue
    } else if (q.type === "text" && q.defaultValue) {
      initialAnswers[q.id] = q.defaultValue
    }
  }

  const [store, setStore] = createStore({
    currentIndex: 0,
    answers: initialAnswers,
    activeButton: "submit" as "submit" | "cancel",
  })

  const dimensions = useTerminalDimensions()
  let scroll: ScrollBoxRenderable | undefined

  onMount(() => {
    dialog.setSize("large")
  })

  const bodyMaxHeight = createMemo(() => {
    // Dialog is rendered starting at ~1/4 screen height, so keep content <= ~3/4.
    const maxDialogHeight = Math.max(10, Math.floor(dimensions().height * 0.75) - 2)
    const chromeHeight = 4 // header + footer
    return Math.max(6, maxDialogHeight - chromeHeight)
  })

  const summaryWidth = createMemo(() => Math.max(20, Math.min(56, dimensions().width - 10)))

  function truncate(text: string, max: number) {
    if (text.length <= max) return text
    return text.slice(0, Math.max(0, max - 3)) + "..."
  }

  function formatSummaryAnswer(question: Question.Item, value: unknown): string {
    switch (question.type) {
      case "select": {
        const v = typeof value === "string" ? value : question.defaultValue
        if (!v) return "(not answered)"
        return question.options.find((o) => o.value === v)?.label ?? v
      }
      case "multi-select": {
        const values = Array.isArray(value) ? value : (question.defaultValue ?? [])
        if (values.length === 0) return "(none selected)"
        const labels = values
          .map((v) => question.options.find((o) => o.value === v)?.label ?? v)
          .slice(0, 2)
          .join(", ")
        return values.length > 2 ? `${labels} +${values.length - 2}` : labels
      }
      case "confirm": {
        const v = typeof value === "boolean" ? value : question.defaultValue
        if (typeof v !== "boolean") return "(not answered)"
        return v ? "Yes" : "No"
      }
      case "text": {
        const v = typeof value === "string" ? value : question.defaultValue
        const trimmed = (v ?? "").trim()
        if (!trimmed) return "(empty)"
        return truncate(trimmed, Math.min(summaryWidth(), 40))
      }
    }
  }

  // Unused but kept for future use
  const _currentQuestion = createMemo(() => props.request.questions[store.currentIndex])

  createEffect(() => {
    const current = props.request.questions[store.currentIndex]
    if (!current) return
    if (!scroll) return

    const target = scroll.getChildren().find((child) => child.id === current.id)
    if (!target) return

    const y = target.y - scroll.y
    if (y >= scroll.height) {
      scroll.scrollBy(y - scroll.height + 1)
    }
    if (y < 0) {
      scroll.scrollBy(y)
    }
  })

  function setAnswer(id: string, value: unknown) {
    setStore("answers", id, value)
  }

  function buildAnswers(): Question.Answer[] {
    const result: Question.Answer[] = []
    for (const q of props.request.questions) {
      const value = store.answers[q.id]
      switch (q.type) {
        case "select":
          result.push({
            type: "select",
            id: q.id,
            value: (value as string) ?? q.defaultValue ?? "",
          })
          break
        case "multi-select":
          result.push({
            type: "multi-select",
            id: q.id,
            values: (value as string[]) ?? q.defaultValue ?? [],
          })
          break
        case "confirm":
          result.push({
            type: "confirm",
            id: q.id,
            value: (value as boolean) ?? q.defaultValue ?? false,
          })
          break
        case "text":
          result.push({
            type: "text",
            id: q.id,
            value: (value as string) ?? q.defaultValue ?? "",
          })
          break
      }
    }
    return result
  }

  useKeyboard((evt) => {
    // Tab to move between questions
    if (evt.name === "tab") {
      if (evt.shift) {
        setStore("currentIndex", Math.max(0, store.currentIndex - 1))
      } else {
        setStore("currentIndex", Math.min(props.request.questions.length - 1, store.currentIndex + 1))
      }
      evt.preventDefault()
    }

    if (evt.ctrl && evt.name === "u") {
      scroll?.scrollBy(-Math.max(1, Math.floor((scroll?.height ?? 0) / 2)))
      evt.preventDefault()
    }

    if (evt.ctrl && evt.name === "d") {
      scroll?.scrollBy(Math.max(1, Math.floor((scroll?.height ?? 0) / 2)))
      evt.preventDefault()
    }

    // Enter to submit (when on last question or button focused)
    if (evt.name === "return") {
      if (store.activeButton === "cancel") {
        props.onCancel()
        dialog.clear()
      } else {
        props.onSubmit(buildAnswers())
        dialog.clear()
      }
      evt.preventDefault()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {props.request.title ?? "Question"}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      <scrollbox
        scrollbarOptions={{ visible: false }}
        ref={(r: ScrollBoxRenderable) => {
          scroll = r
        }}
        maxHeight={bodyMaxHeight()}
      >
        <For each={props.request.questions}>
          {(question, index) => {
            const active = createMemo(() => index() === store.currentIndex)
            const answerSummary = createMemo(() => formatSummaryAnswer(question, store.answers[question.id]))

            return (
              <box id={question.id} paddingLeft={active() ? 2 : 1} onMouseUp={() => setStore("currentIndex", index())}>
                <Show
                  when={active()}
                  fallback={
                    <box flexDirection="row" gap={2} overflow="hidden">
                      <text fg={theme.textMuted}>▸ {index() + 1}.</text>
                      <text fg={theme.text}>{truncate(question.message, summaryWidth())}</text>
                      <box flexGrow={1} />
                      <text fg={theme.textMuted}>{truncate(answerSummary(), 24)}</text>
                    </box>
                  }
                >
                  <Switch>
                    <Match when={question.type === "select"}>
                      <DialogQuestionSelect
                        question={question as Question.SelectQuestion}
                        value={store.answers[question.id] as string | undefined}
                        onChange={(v) => setAnswer(question.id, v)}
                        active={true}
                      />
                    </Match>
                    <Match when={question.type === "multi-select"}>
                      <DialogQuestionMultiSelect
                        question={question as Question.MultiSelectQuestion}
                        value={(store.answers[question.id] as string[]) ?? []}
                        onChange={(v) => setAnswer(question.id, v)}
                        active={true}
                      />
                    </Match>
                    <Match when={question.type === "confirm"}>
                      <DialogQuestionConfirm
                        question={question as Question.ConfirmQuestion}
                        value={store.answers[question.id] as boolean | undefined}
                        onChange={(v) => setAnswer(question.id, v)}
                        active={true}
                      />
                    </Match>
                    <Match when={question.type === "text"}>
                      <DialogQuestionText
                        question={question as Question.TextQuestion}
                        value={store.answers[question.id] as string | undefined}
                        onChange={(v) => setAnswer(question.id, v)}
                        active={true}
                      />
                    </Match>
                  </Switch>
                </Show>
              </box>
            )
          }}
        </For>
      </scrollbox>

      <box flexDirection="row" justifyContent="flex-end" gap={2}>
        <Show when={props.request.questions.length > 1}>
          <text fg={theme.textMuted}>
            {store.currentIndex + 1}/{props.request.questions.length} tab next
          </text>
        </Show>
        <text fg={theme.textMuted}>ctrl+u/d scroll</text>
        <text fg={theme.textMuted}>enter submit</text>
        <box flexGrow={1} />
        <For each={["cancel", "submit"]}>
          {(key) => (
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={key === store.activeButton ? theme.primary : undefined}
              onMouseUp={() => {
                if (key === "submit") {
                  props.onSubmit(buildAnswers())
                } else {
                  props.onCancel()
                }
                dialog.clear()
              }}
              onMouseOver={() => setStore("activeButton", key as "submit" | "cancel")}
            >
              <text fg={key === store.activeButton ? fg : theme.textMuted}>
                {key === "submit" ? "Submit" : "Cancel"}
              </text>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}
