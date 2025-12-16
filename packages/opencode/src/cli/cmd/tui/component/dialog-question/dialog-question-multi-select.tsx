import { TextAttributes } from "@opentui/core"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { For, createMemo } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import type { Question } from "@/question"

export interface DialogQuestionMultiSelectProps {
  question: Question.MultiSelectQuestion
  value: string[]
  onChange: (value: string[]) => void
  active: boolean
}

export function DialogQuestionMultiSelect(props: DialogQuestionMultiSelectProps) {
  const { theme } = useTheme()
  const fg = selectedForeground(theme)

  const focusedIndex = createMemo(() => {
    // Track which option is focused (not selected)
    // Default to first option
    return 0
  })

  // Track selected values
  const selectedValues = createMemo(() => new Set(props.value))

  useKeyboard((evt) => {
    if (!props.active) return

    if (evt.name === "space") {
      // Toggle selection of focused item
      const option = props.question.options[focusedIndex()]
      if (option) {
        const current = new Set(props.value)
        if (current.has(option.value)) {
          current.delete(option.value)
        } else {
          // Check max constraint
          if (props.question.max && current.size >= props.question.max) {
            return
          }
          current.add(option.value)
        }
        props.onChange(Array.from(current))
      }
      evt.preventDefault()
    }
  })

  return (
    <box gap={0}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        {props.question.message}
      </text>
      <text fg={theme.textMuted}>
        (space to toggle{props.question.min ? `, min: ${props.question.min}` : ""}
        {props.question.max ? `, max: ${props.question.max}` : ""})
      </text>
      <box paddingTop={1}>
        <For each={props.question.options}>
          {(option) => {
            const selected = createMemo(() => selectedValues().has(option.value))
            return (
              <box
                flexDirection="row"
                gap={1}
                paddingLeft={1}
                paddingRight={1}
                onMouseUp={() => {
                  const current = new Set(props.value)
                  if (current.has(option.value)) {
                    current.delete(option.value)
                  } else {
                    if (!props.question.max || current.size < props.question.max) {
                      current.add(option.value)
                    }
                  }
                  props.onChange(Array.from(current))
                }}
              >
                <text fg={selected() ? theme.primary : theme.textMuted}>{selected() ? "☑" : "☐"}</text>
                <text fg={selected() ? fg : theme.text}>{option.label}</text>
                {option.hint && <text fg={theme.textMuted}>{option.hint}</text>}
              </box>
            )
          }}
        </For>
      </box>
    </box>
  )
}
