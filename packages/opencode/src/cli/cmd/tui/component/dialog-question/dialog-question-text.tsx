import { TextAttributes, type InputRenderable } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { onMount } from "solid-js"
import type { Question } from "@/question"

export interface DialogQuestionTextProps {
  question: Question.TextQuestion
  value: string | undefined
  onChange: (value: string) => void
  active: boolean
}

export function DialogQuestionText(props: DialogQuestionTextProps) {
  const { theme } = useTheme()
  let input: InputRenderable

  onMount(() => {
    if (props.active) {
      setTimeout(() => input?.focus(), 1)
    }
    // Set default value if provided
    if (props.question.defaultValue && !props.value) {
      props.onChange(props.question.defaultValue)
    }
  })

  return (
    <box gap={0}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        {props.question.message}
      </text>
      <box paddingTop={1}>
        <input
          ref={(r) => (input = r)}
          value={props.value ?? ""}
          onInput={(e) => props.onChange(e)}
          focusedBackgroundColor={theme.backgroundPanel}
          cursorColor={theme.primary}
          focusedTextColor={theme.text}
          placeholder={props.question.placeholder ?? ""}
        />
      </box>
    </box>
  )
}
