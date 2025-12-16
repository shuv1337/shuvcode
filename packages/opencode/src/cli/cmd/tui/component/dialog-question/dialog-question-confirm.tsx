import { TextAttributes } from "@opentui/core"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { createMemo, For } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import type { Question } from "@/question"

export interface DialogQuestionConfirmProps {
  question: Question.ConfirmQuestion
  value: boolean | undefined
  onChange: (value: boolean) => void
  active: boolean
}

export function DialogQuestionConfirm(props: DialogQuestionConfirmProps) {
  const { theme } = useTheme()
  const fg = selectedForeground(theme)

  const selected = createMemo(() => props.value ?? props.question.defaultValue ?? false)

  useKeyboard((evt) => {
    if (!props.active) return

    if (evt.name === "left" || evt.name === "right") {
      props.onChange(!selected())
      evt.preventDefault()
    }
    if (evt.name === "y") {
      props.onChange(true)
      evt.preventDefault()
    }
    if (evt.name === "n") {
      props.onChange(false)
      evt.preventDefault()
    }
  })

  return (
    <box gap={0}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        {props.question.message}
      </text>
      <box paddingTop={1} flexDirection="row" gap={2}>
        <For each={[true, false]}>
          {(val) => {
            const active = createMemo(() => selected() === val)
            return (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={active() ? theme.primary : undefined}
                onMouseUp={() => props.onChange(val)}
              >
                <text fg={active() ? fg : theme.textMuted}>{val ? "Yes" : "No"}</text>
              </box>
            )
          }}
        </For>
      </box>
    </box>
  )
}
