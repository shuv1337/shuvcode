import { TextAttributes } from "@opentui/core"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { For, Show, Switch, Match, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard } from "@opentui/solid"
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

  // Unused but kept for future use
  const _currentQuestion = createMemo(() => props.request.questions[store.currentIndex])

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

      <box paddingTop={1} gap={2}>
        <For each={props.request.questions}>
          {(question, index) => {
            const active = createMemo(() => index() === store.currentIndex)
            return (
              <box paddingLeft={active() ? 2 : 1}>
                <Switch>
                  <Match when={question.type === "select"}>
                    <DialogQuestionSelect
                      question={question as Question.SelectQuestion}
                      value={store.answers[question.id] as string | undefined}
                      onChange={(v) => setAnswer(question.id, v)}
                      active={active()}
                    />
                  </Match>
                  <Match when={question.type === "multi-select"}>
                    <DialogQuestionMultiSelect
                      question={question as Question.MultiSelectQuestion}
                      value={(store.answers[question.id] as string[]) ?? []}
                      onChange={(v) => setAnswer(question.id, v)}
                      active={active()}
                    />
                  </Match>
                  <Match when={question.type === "confirm"}>
                    <DialogQuestionConfirm
                      question={question as Question.ConfirmQuestion}
                      value={store.answers[question.id] as boolean | undefined}
                      onChange={(v) => setAnswer(question.id, v)}
                      active={active()}
                    />
                  </Match>
                  <Match when={question.type === "text"}>
                    <DialogQuestionText
                      question={question as Question.TextQuestion}
                      value={store.answers[question.id] as string | undefined}
                      onChange={(v) => setAnswer(question.id, v)}
                      active={active()}
                    />
                  </Match>
                </Switch>
              </box>
            )
          }}
        </For>
      </box>

      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1} paddingTop={1} gap={1}>
        <Show when={props.request.questions.length > 1}>
          <text fg={theme.textMuted}>
            {store.currentIndex + 1}/{props.request.questions.length} (tab to navigate)
          </text>
        </Show>
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
