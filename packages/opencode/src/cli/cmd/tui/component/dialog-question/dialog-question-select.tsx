import { ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
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
    const idx = props.question.options.findIndex((o) => o.value === val)
    return idx >= 0 ? idx : 0
  })

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
    if (!scroll) return
    if (!props.active) return

    const option = props.question.options[selectedIndex()]
    if (!option) return

    const target = scroll.getChildren().find((child) => child.id === option.value)
    if (!target) return

    const y = target.y - scroll.y
    if (y >= scroll.height) {
      scroll.scrollBy(y - scroll.height + 1)
    }
    if (y < 0) {
      scroll.scrollBy(y)
      if (selectedIndex() === 0) scroll.scrollTo(0)
    }

    updateScrollIndicators()
  })

  function moveTo(index: number) {
    const options = props.question.options
    if (options.length === 0) return

    let next = index
    if (next < 0) next = options.length - 1
    if (next >= options.length) next = 0

    props.onChange(options[next].value)
  }

  useKeyboard((evt) => {
    if (!props.active) return

    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      moveTo(selectedIndex() - 1)
      evt.preventDefault()
    }

    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      moveTo(selectedIndex() + 1)
      evt.preventDefault()
    }

    if (evt.name === "pageup") {
      moveTo(selectedIndex() - 10)
      evt.preventDefault()
    }

    if (evt.name === "pagedown") {
      moveTo(selectedIndex() + 10)
      evt.preventDefault()
    }

    if (evt.name === "home") {
      moveTo(0)
      evt.preventDefault()
    }

    if (evt.name === "end") {
      moveTo(props.question.options.length - 1)
      evt.preventDefault()
    }
  })

  return (
    <box gap={0}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        {props.question.message}
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
            const selected = createMemo(() => index() === selectedIndex())
            return (
              <box
                id={option.value}
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
      </scrollbox>

      <Show when={canScrollDown()}>
        <text fg={theme.textMuted}>↓ more options</text>
      </Show>

      <Show when={canScrollUp() || canScrollDown()}>
        <text fg={theme.textMuted}>↑/↓ navigate • pgup/pgdn jump</text>
      </Show>
    </box>
  )
}
