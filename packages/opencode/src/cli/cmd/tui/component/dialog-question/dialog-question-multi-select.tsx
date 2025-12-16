import { ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
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

  const [focusedIndex, setFocusedIndex] = createSignal(0)

  const dimensions = useTerminalDimensions()
  const maxHeight = createMemo(() => Math.max(4, Math.floor(dimensions().height * 0.4)))

  let scroll: ScrollBoxRenderable | undefined
  const [canScrollUp, setCanScrollUp] = createSignal(false)
  const [canScrollDown, setCanScrollDown] = createSignal(false)

  function updateScrollIndicators() {
    if (!scroll) return
    const y = scroll.y
    const height = scroll.height
    const total = scroll.scrollHeight

    setCanScrollUp(y > 0)
    setCanScrollDown(y + height < total)
  }

  createEffect(() => {
    const optionsLength = props.question.options.length
    const current = focusedIndex()
    if (optionsLength === 0) return
    if (current >= optionsLength) setFocusedIndex(optionsLength - 1)
  })

  // Track selected values
  const selectedValues = createMemo(() => new Set(props.value))

  function moveTo(index: number) {
    const optionsLength = props.question.options.length
    if (optionsLength === 0) return

    let next = index
    if (next < 0) next = optionsLength - 1
    if (next >= optionsLength) next = 0

    setFocusedIndex(next)
  }

  function toggle(value: string) {
    const current = new Set(props.value)

    if (current.has(value)) {
      current.delete(value)
      props.onChange(Array.from(current))
      return
    }

    // Check max constraint
    if (props.question.max && current.size >= props.question.max) {
      return
    }

    current.add(value)
    props.onChange(Array.from(current))
  }

  createEffect(() => {
    if (!scroll) return
    if (!props.active) return

    const option = props.question.options[focusedIndex()]
    if (!option) return

    const target = scroll.getChildren().find((child) => child.id === option.value)
    if (!target) return

    const y = target.y - scroll.y
    if (y >= scroll.height) {
      scroll.scrollBy(y - scroll.height + 1)
    }
    if (y < 0) {
      scroll.scrollBy(y)
      if (focusedIndex() === 0) scroll.scrollTo(0)
    }

    updateScrollIndicators()
  })

  useKeyboard((evt) => {
    if (!props.active) return

    const optionsLength = props.question.options.length
    if (optionsLength === 0) return

    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      moveTo(focusedIndex() - 1)
      evt.preventDefault()
    }

    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      moveTo(focusedIndex() + 1)
      evt.preventDefault()
    }

    if (evt.name === "pageup") {
      moveTo(focusedIndex() - 10)
      evt.preventDefault()
    }

    if (evt.name === "pagedown") {
      moveTo(focusedIndex() + 10)
      evt.preventDefault()
    }

    if (evt.name === "home") {
      moveTo(0)
      evt.preventDefault()
    }

    if (evt.name === "end") {
      moveTo(optionsLength - 1)
      evt.preventDefault()
    }

    if (evt.name === "space") {
      const option = props.question.options[focusedIndex()]
      if (!option) return
      toggle(option.value)
      evt.preventDefault()
    }
  })

  return (
    <box gap={0}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        {props.question.message}
      </text>
      <text fg={theme.textMuted}>
        (↑/↓ move, space toggle{props.question.min ? `, min: ${props.question.min}` : ""}
        {props.question.max ? `, max: ${props.question.max}` : ""})
      </text>

      <Show when={canScrollUp()}>
        <text fg={theme.textMuted}>↑ more options</text>
      </Show>

      <scrollbox
        paddingLeft={1}
        scrollbarOptions={{ visible: false }}
        ref={(r: ScrollBoxRenderable) => {
          scroll = r
          setTimeout(() => updateScrollIndicators(), 0)
        }}
        maxHeight={maxHeight()}
      >
        <For each={props.question.options}>
          {(option, index) => {
            const focused = createMemo(() => index() === focusedIndex())
            const selected = createMemo(() => selectedValues().has(option.value))
            return (
              <box
                id={option.value}
                flexDirection="row"
                gap={1}
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={focused() ? theme.primary : undefined}
                onMouseUp={() => {
                  moveTo(index())
                  toggle(option.value)
                }}
              >
                <text fg={focused() ? fg : theme.textMuted}>{focused() ? "›" : " "}</text>
                <text fg={focused() ? fg : selected() ? theme.primary : theme.textMuted}>
                  {selected() ? "☑" : "☐"}
                </text>
                <text fg={focused() ? fg : theme.text}>{option.label}</text>
                {option.hint && <text fg={focused() ? fg : theme.textMuted}>{option.hint}</text>}
              </box>
            )
          }}
        </For>
      </scrollbox>

      <Show when={canScrollDown()}>
        <text fg={theme.textMuted}>↓ more options</text>
      </Show>

      <Show when={canScrollUp() || canScrollDown()}>
        <text fg={theme.textMuted}>pgup/pgdn jump • home/end</text>
      </Show>
    </box>
  )
}
