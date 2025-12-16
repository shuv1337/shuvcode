import { TextAttributes } from "@opentui/core"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { For, createMemo } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import type { Question } from "@/question"

export interface DialogQuestionSelectProps {
  question: Question.SelectQuestion
  value: string | undefined
  onChange: (value: string) => void
  active: boolean
}

export function DialogQuestionSelect(props: DialogQuestionSelectProps) {
  const { theme } = useTheme()
  const fg = selectedForeground(theme)

  const selectedIndex = createMemo(() => {
    const val = props.value ?? props.question.defaultValue
    return props.question.options.findIndex((o) => o.value === val)
  })

  useKeyboard((evt) => {
    if (!props.active) return

    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      let next = selectedIndex() - 1
      if (next < 0) next = props.question.options.length - 1
      props.onChange(props.question.options[next].value)
      evt.preventDefault()
    }
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      let next = selectedIndex() + 1
      if (next >= props.question.options.length) next = 0
      props.onChange(props.question.options[next].value)
      evt.preventDefault()
    }
  })

  return (
    <box gap={0}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        {props.question.message}
      </text>
      <box paddingTop={1}>
        <For each={props.question.options}>
          {(option, index) => {
            const selected = createMemo(() => index() === selectedIndex())
            return (
              <box
                flexDirection="row"
                gap={1}
                backgroundColor={selected() ? theme.primary : undefined}
                paddingLeft={1}
                paddingRight={1}
                onMouseUp={() => props.onChange(option.value)}
              >
                <text fg={selected() ? fg : theme.textMuted}>{selected() ? "●" : "○"}</text>
                <text fg={selected() ? fg : theme.text}>{option.label}</text>
                {option.hint && <text fg={selected() ? fg : theme.textMuted}>{option.hint}</text>}
              </box>
            )
          }}
        </For>
      </box>
    </box>
  )
}
