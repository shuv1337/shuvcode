import { createMemo, For, onMount, onCleanup, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TextField } from "@opencode-ai/ui/text-field"

// Types matching packages/opencode/src/askquestion/index.ts
export interface AskQuestionOption {
  value: string
  label: string
  description?: string
}

export interface AskQuestionQuestion {
  id: string
  label: string // Short tab label, e.g. "UI Framework"
  question: string // Full question text
  options: AskQuestionOption[] // 2-8 options
  multiSelect?: boolean
}

export interface AskQuestionAnswer {
  questionId: string
  values: string[] // Selected option value(s)
  customText?: string // Custom text if user typed their own response
}

export interface PendingAskQuestion {
  callID: string
  messageID: string
  questions: AskQuestionQuestion[]
}

export interface AskQuestionWizardProps {
  questions: AskQuestionQuestion[]
  onSubmit: (answers: AskQuestionAnswer[]) => void
  onCancel: () => void
}

interface QuestionState {
  selectedOption: number
  selectedValues: string[]
  customText?: string
}

export function AskQuestionWizard(props: AskQuestionWizardProps) {
  // State for the wizard
  const [store, setStore] = createStore({
    activeTab: 0,
    questionStates: props.questions.map(() => ({
      selectedOption: 0,
      selectedValues: [] as string[],
      customText: undefined as string | undefined,
    })) as QuestionState[],
    isTypingCustom: false,
    customInputValue: "",
  })

  let containerRef: HTMLDivElement | undefined
  let inputRef: HTMLInputElement | undefined

  // Current question based on active tab
  const currentQuestion = createMemo(() => props.questions[store.activeTab])
  const currentState = createMemo(() => store.questionStates[store.activeTab])

  // Options including "Type something..." at the end
  const optionsWithCustom = createMemo(() => [
    ...currentQuestion().options,
    { value: "__custom__", label: "Type something...", description: "Enter your own response" },
  ])

  // Check if all questions have at least one answer
  const allAnswered = createMemo(() =>
    store.questionStates.every((state) => state.selectedValues.length > 0 || state.customText),
  )

  // Check if current question is answered
  const currentAnswered = createMemo(() => {
    const state = currentState()
    return state.selectedValues.length > 0 || state.customText
  })

  function handleSubmit() {
    if (!allAnswered()) return
    const answers: AskQuestionAnswer[] = props.questions.map((q, i) => {
      const state = store.questionStates[i]
      return {
        questionId: q.id,
        values: state.selectedValues,
        customText: state.customText,
      }
    })
    props.onSubmit(answers)
  }

  function selectOption(optionValue: string) {
    const question = currentQuestion()
    setStore(
      produce((s) => {
        const state = s.questionStates[s.activeTab]
        state.customText = undefined

        if (question.multiSelect) {
          // Toggle for multi-select
          const idx = state.selectedValues.indexOf(optionValue)
          if (idx >= 0) {
            state.selectedValues.splice(idx, 1)
          } else {
            state.selectedValues.push(optionValue)
          }
        } else {
          // Select for single-select and auto-advance
          state.selectedValues = [optionValue]
          if (s.activeTab < props.questions.length - 1) {
            s.activeTab++
          }
        }
      }),
    )
    // Auto-submit if single-select on last question and all answered
    if (!question.multiSelect) {
      setTimeout(() => {
        if (allAnswered()) {
          handleSubmit()
        }
      }, 50)
    }
  }

  function navigateOption(direction: "up" | "down") {
    const current = currentState().selectedOption
    const max = optionsWithCustom().length - 1
    setStore(
      produce((s) => {
        if (direction === "up") {
          s.questionStates[s.activeTab].selectedOption = current > 0 ? current - 1 : max
        } else {
          s.questionStates[s.activeTab].selectedOption = current < max ? current + 1 : 0
        }
      }),
    )
  }

  function navigateQuestion(direction: "left" | "right") {
    if (direction === "right") {
      if (store.activeTab < props.questions.length - 1) {
        setStore("activeTab", store.activeTab + 1)
      } else if (allAnswered()) {
        handleSubmit()
      }
    } else {
      if (store.activeTab > 0) {
        setStore("activeTab", store.activeTab - 1)
      }
    }
  }

  function openCustomInput() {
    setStore("isTypingCustom", true)
    setTimeout(() => inputRef?.focus(), 10)
  }

  function submitCustomInput() {
    const value = store.customInputValue.trim()
    if (value) {
      setStore(
        produce((s) => {
          s.questionStates[s.activeTab].customText = value
          s.questionStates[s.activeTab].selectedValues = []
        }),
      )
    }
    setStore("isTypingCustom", false)
    setStore("customInputValue", "")
    // Auto-advance to next question or submit
    if (store.activeTab < props.questions.length - 1) {
      setStore("activeTab", store.activeTab + 1)
    } else if (allAnswered()) {
      handleSubmit()
    }
  }

  function handleKeyDown(evt: KeyboardEvent) {
    // Allow the event to be handled when inside our component
    if (store.isTypingCustom) {
      // In custom input mode
      if (evt.key === "Escape") {
        evt.preventDefault()
        evt.stopPropagation()
        setStore("isTypingCustom", false)
        setStore("customInputValue", "")
        return
      }
      if (evt.key === "Enter" && !evt.shiftKey) {
        evt.preventDefault()
        evt.stopPropagation()
        submitCustomInput()
        return
      }
      // Let other keys through for typing
      return
    }

    // Tab/arrow navigation between questions
    if (evt.key === "Tab" && !evt.shiftKey) {
      evt.preventDefault()
      evt.stopPropagation()
      navigateQuestion("right")
      return
    }
    if (evt.key === "Tab" && evt.shiftKey) {
      evt.preventDefault()
      evt.stopPropagation()
      navigateQuestion("left")
      return
    }
    if (evt.key === "ArrowRight") {
      evt.preventDefault()
      evt.stopPropagation()
      navigateQuestion("right")
      return
    }
    if (evt.key === "ArrowLeft") {
      evt.preventDefault()
      evt.stopPropagation()
      navigateQuestion("left")
      return
    }

    // Up/down navigation within options
    if (evt.key === "ArrowUp" || (evt.ctrlKey && evt.key === "p")) {
      evt.preventDefault()
      evt.stopPropagation()
      navigateOption("up")
      return
    }
    if (evt.key === "ArrowDown" || (evt.ctrlKey && evt.key === "n")) {
      evt.preventDefault()
      evt.stopPropagation()
      navigateOption("down")
      return
    }

    // Space to toggle selection (especially useful for multi-select)
    if (evt.key === " ") {
      evt.preventDefault()
      evt.stopPropagation()
      const selectedIdx = currentState().selectedOption
      const option = optionsWithCustom()[selectedIdx]

      if (option.value === "__custom__") {
        openCustomInput()
        return
      }

      selectOption(option.value)
      return
    }

    // Enter to select option (single-select) or confirm and advance (multi-select)
    if (evt.key === "Enter" && !evt.ctrlKey && !evt.metaKey) {
      evt.preventDefault()
      evt.stopPropagation()
      const selectedIdx = currentState().selectedOption
      const option = optionsWithCustom()[selectedIdx]

      if (option.value === "__custom__") {
        openCustomInput()
        return
      }

      const question = currentQuestion()
      if (question.multiSelect) {
        // For multi-select: Enter confirms current selections and advances
        if (currentAnswered()) {
          navigateQuestion("right")
          return
        }
        // If nothing selected yet, toggle the current option
        selectOption(option.value)
        return
      }

      // Single-select: select and advance
      selectOption(option.value)
      return
    }

    // Number keys for quick selection (1-8)
    if (evt.key >= "1" && evt.key <= "8" && !evt.ctrlKey && !evt.metaKey) {
      evt.preventDefault()
      evt.stopPropagation()
      const idx = parseInt(evt.key) - 1
      if (idx < currentQuestion().options.length) {
        const option = currentQuestion().options[idx]
        selectOption(option.value)
      }
      return
    }

    // Escape to cancel
    if (evt.key === "Escape") {
      evt.preventDefault()
      evt.stopPropagation()
      props.onCancel()
      return
    }

    // Ctrl+Enter to submit
    if ((evt.ctrlKey || evt.metaKey) && evt.key === "Enter") {
      evt.preventDefault()
      evt.stopPropagation()
      if (allAnswered()) {
        handleSubmit()
      }
      return
    }
  }

  onMount(() => {
    // Focus container to capture keyboard events
    containerRef?.focus()
    document.addEventListener("keydown", handleKeyDown, true)
  })

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown, true)
  })

  return (
    <div
      ref={containerRef}
      data-component="askquestion-wizard"
      data-prevent-autofocus
      class="flex flex-col gap-4 p-4 bg-surface-base rounded-lg border border-border-weak-base shadow-lg"
      style={{ "padding-bottom": "calc(1rem + var(--safe-area-inset-bottom))" }}
      tabIndex={0}
    >
      <div class="flex items-center justify-between">
        <div class="text-12-medium text-text-weaker">Answer the questions</div>
        <IconButton
          icon="close"
          variant="ghost"
          iconSize="large"
          aria-label="Cancel"
          onClick={props.onCancel}
        />
      </div>
      {/* Tab bar */}
      <div class="flex items-center gap-2 overflow-x-auto pb-2 border-b border-border-weak-base">
        <span class="text-text-weaker text-12-medium shrink-0">&larr;</span>
        <For each={props.questions}>
          {(question, index) => {
            const isActive = createMemo(() => store.activeTab === index())
            const isAnswered = createMemo(() => {
              const state = store.questionStates[index()]
              return state.selectedValues.length > 0 || !!state.customText
            })
            return (
              <button
                type="button"
                class="flex items-center gap-1.5 px-2 py-1 rounded-sm transition-colors shrink-0"
                classList={{
                  "bg-surface-stronger": isActive(),
                  "hover:bg-surface-stronger/50": !isActive(),
                }}
                onClick={() => setStore("activeTab", index())}
              >
                <span
                  class="text-12-medium"
                  classList={{
                    "text-success": isAnswered(),
                    "text-text-weaker": !isAnswered(),
                  }}
                >
                  {isAnswered() ? "\u25CF" : "\u25CB"}
                </span>
                <span
                  class="text-12-medium"
                  classList={{
                    "text-text-strong font-semibold": isActive(),
                    "text-text-weak": !isActive(),
                  }}
                >
                  {question.label}
                </span>
              </button>
            )
          }}
        </For>
        <Show when={allAnswered()}>
          <button
            type="button"
            class="flex items-center gap-1.5 px-2 py-1 rounded-sm text-success hover:bg-success/10 shrink-0 ml-auto"
            onClick={handleSubmit}
          >
            <span class="text-12-medium">{"\u2713"}</span>
            <span class="text-12-medium font-semibold">Submit</span>
          </button>
        </Show>
        <span class="text-text-weaker text-12-medium shrink-0">&rarr;</span>
      </div>

      {/* Current question */}
      <div class="flex flex-col gap-1">
        <h3 class="text-14-medium text-primary font-semibold">{currentQuestion().question}</h3>
        <Show when={currentQuestion().multiSelect}>
          <p class="text-12-medium text-text-weaker">(select multiple, press Enter to confirm)</p>
        </Show>
      </div>

      {/* Options */}
      <div class="flex flex-col gap-1 max-h-60 overflow-y-auto">
        <For each={optionsWithCustom()}>
          {(option, index) => {
            const isSelected = createMemo(() => currentState().selectedOption === index())
            const isChosen = createMemo(() => {
              if (option.value === "__custom__") {
                return !!currentState().customText
              }
              return currentState().selectedValues.includes(option.value)
            })
            const isCustomOption = option.value === "__custom__"

            return (
              <button
                type="button"
                class="flex items-center gap-3 px-3 py-2 rounded-sm transition-colors text-left"
                classList={{
                  "bg-primary text-text-on-primary": isSelected(),
                  "hover:bg-surface-stronger": !isSelected(),
                }}
                onClick={() => {
                  setStore(
                    produce((s) => {
                      s.questionStates[s.activeTab].selectedOption = index()
                    }),
                  )
                  if (isCustomOption) {
                    openCustomInput()
                  } else {
                    selectOption(option.value)
                  }
                }}
              >
                {/* Selection indicator */}
                <span
                  class="text-14-medium shrink-0"
                  classList={{
                    "text-text-on-primary": isSelected(),
                    "text-text-weaker": !isSelected() && !isChosen(),
                    "text-success": !isSelected() && isChosen(),
                  }}
                >
                  {isCustomOption
                    ? "\u203A"
                    : currentQuestion().multiSelect
                      ? isChosen()
                        ? "[\u2713]"
                        : "[ ]"
                      : isChosen()
                        ? "\u25CF"
                        : "\u25CB"}
                </span>
                {/* Option label */}
                <span
                  class="text-14-medium"
                  classList={{
                    "text-text-on-primary": isSelected(),
                    "text-text-strong font-semibold": !isSelected() && isChosen(),
                    "text-text-base": !isSelected() && !isChosen(),
                  }}
                >
                  {option.label}
                </span>
                {/* Option description */}
                <Show when={option.description && !isCustomOption}>
                  <span
                    class="text-12-medium"
                    classList={{
                      "text-text-on-primary/70": isSelected(),
                      "text-text-weaker": !isSelected(),
                    }}
                  >
                    {option.description}
                  </span>
                </Show>
              </button>
            )
          }}
        </For>
      </div>

      {/* Custom input (when active) */}
      <Show when={store.isTypingCustom}>
        <div class="flex flex-col gap-2">
          <TextField
            ref={inputRef}
            placeholder="Type your response..."
            value={store.customInputValue}
            onChange={(value) => setStore("customInputValue", value)}
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                submitCustomInput()
              } else if (e.key === "Escape") {
                e.preventDefault()
                setStore("isTypingCustom", false)
                setStore("customInputValue", "")
              }
            }}
          />
          <div class="flex gap-2">
            <Button size="small" variant="primary" onClick={submitCustomInput}>
              Confirm
            </Button>
            <Button
              size="small"
              variant="ghost"
              onClick={() => {
                setStore("isTypingCustom", false)
                setStore("customInputValue", "")
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      </Show>

      {/* Instructions - hidden on mobile */}
      <div class="hidden sm:block pt-2 border-t border-border-weak-base">
        <p class="text-11-medium text-text-weaker">
          {currentQuestion().multiSelect
            ? "Space to toggle \u00B7 Enter to confirm \u00B7 \u2191\u2193 to navigate \u00B7 Esc to cancel"
            : "Enter/Space to select \u00B7 \u2191\u2193 to navigate \u00B7 Esc to cancel"}
        </p>
      </div>

      {/* Action buttons - desktop */}
      <div class="hidden sm:flex justify-between items-center pt-2">
        <Button size="small" variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
        <Show when={allAnswered()}>
          <Button size="small" variant="primary" onClick={handleSubmit}>
            Submit All
          </Button>
        </Show>
      </div>

      {/* Sticky footer - mobile only */}
      <div class="sm:hidden sticky bottom-0 left-0 right-0 -mx-4 -mb-4 px-4 py-3 bg-surface-base border-t border-border-weak-base flex justify-between items-center gap-3">
        <Button size="normal" variant="ghost" onClick={props.onCancel} class="flex-1">
          Cancel
        </Button>
        <Show when={allAnswered()}>
          <Button size="normal" variant="primary" onClick={handleSubmit} class="flex-1">
            Submit
          </Button>
        </Show>
      </div>
    </div>
  )
}
