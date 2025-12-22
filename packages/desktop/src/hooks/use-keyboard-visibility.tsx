import { createSignal, onMount, onCleanup } from "solid-js"

export function useKeyboardVisibility() {
  const [keyboardHeight, setKeyboardHeight] = createSignal(0)
  const [isKeyboardVisible, setIsKeyboardVisible] = createSignal(false)

  onMount(() => {
    if (!window.visualViewport) return

    const handleResize = () => {
      const height = window.innerHeight - window.visualViewport!.height
      const clamped = Math.max(0, height)
      setKeyboardHeight(clamped)
      const visible = clamped > 100
      setIsKeyboardVisible(visible)
      document.documentElement.style.setProperty("--keyboard-offset", `${clamped}px`)

      // Set data attribute on document element for CSS targeting
      if (visible) {
        document.documentElement.setAttribute("data-keyboard-visible", "true")
      } else {
        document.documentElement.removeAttribute("data-keyboard-visible")
      }
    }

    const handleScroll = () => {
      // Recalculate on scroll to handle iOS PWA viewport changes
      const height = window.innerHeight - window.visualViewport!.height
      const clamped = Math.max(0, height)
      document.documentElement.style.setProperty("--keyboard-offset", `${clamped}px`)
    }

    window.visualViewport.addEventListener("resize", handleResize)
    window.visualViewport.addEventListener("scroll", handleScroll)
    onCleanup(() => {
      window.visualViewport?.removeEventListener("resize", handleResize)
      window.visualViewport?.removeEventListener("scroll", handleScroll)
      // Clean up the data attribute
      document.documentElement.removeAttribute("data-keyboard-visible")
    })
  })

  return { keyboardHeight, isKeyboardVisible }
}
