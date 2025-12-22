import { Component, createSignal } from "solid-js"

export interface MobileTerminalInputProps {
  socket: WebSocket | undefined
  enabled?: boolean
  onKeyboardShow?: () => void
  onKeyboardHide?: () => void
  ref?: (el: HTMLInputElement) => void
}

export const MobileTerminalInput: Component<MobileTerminalInputProps> = (props) => {
  let inputRef!: HTMLInputElement
  // Track the previous input length to detect deletions
  const [prevLength, setPrevLength] = createSignal(0)

  const setRef = (el: HTMLInputElement) => {
    inputRef = el
    props.ref?.(el)
  }

  const handleFocus = () => {
    props.onKeyboardShow?.()
  }

  const handleBlur = () => {
    props.onKeyboardHide?.()
  }

  const handleInput = (event: InputEvent) => {
    if (!props.socket || props.socket.readyState !== WebSocket.OPEN) return
    const input = event.currentTarget as HTMLInputElement
    const currentLength = input.value.length
    const previous = prevLength()

    if (currentLength > previous) {
      // Characters were added - send only the new characters
      const newChars = input.value.slice(previous)
      props.socket.send(newChars)
    } else if (currentLength < previous) {
      // Characters were deleted (backspace) - send DEL for each deleted char
      const deletedCount = previous - currentLength
      for (let i = 0; i < deletedCount; i++) {
        props.socket.send("\u007f")
      }
    }

    setPrevLength(currentLength)
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!props.socket || props.socket.readyState !== WebSocket.OPEN) return

    let data = ""
    const key = event.key

    switch (key) {
      case "Enter":
        data = "\r"
        event.preventDefault()
        break
      case "ArrowUp":
        data = "\u001b[A"
        event.preventDefault()
        break
      case "ArrowDown":
        data = "\u001b[B"
        event.preventDefault()
        break
      case "ArrowLeft":
        data = "\u001b[D"
        event.preventDefault()
        break
      case "ArrowRight":
        data = "\u001b[C"
        event.preventDefault()
        break
      case "Tab":
        data = "\t"
        event.preventDefault()
        break
      // Backspace is handled via handleInput by detecting length change
      default:
        return
    }

    if (data) {
      props.socket.send(data)
    }
  }

  const handleClick = () => {
    if (inputRef && props.enabled !== false) {
      inputRef.focus()
    }
  }

  return (
    <input
      ref={setRef}
      type="text"
      inputMode="text"
      autocomplete="off"
      autocorrect="off"
      autocapitalize="off"
      spellcheck={false}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onClick={handleClick}
      classList={{
        // Position at bottom-left corner, small and invisible but focusable
        "absolute bottom-0 left-0 w-1 h-1 opacity-0 pointer-events-none": true,
        "!pointer-events-auto": props.enabled !== false,
      }}
      disabled={props.enabled === false}
    />
  )
}
