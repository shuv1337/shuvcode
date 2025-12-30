import { Ghostty, Terminal as Term, FitAddon } from "ghostty-web"
import { ComponentProps, onCleanup, onMount, splitProps, Show, createSignal } from "solid-js"
import { useSDK } from "@/context/sdk"
import { SerializeAddon } from "@/addons/serialize"
import { LocalPTY } from "@/context/terminal"
import { MobileTerminalInput } from "./mobile-terminal-input"

function getWebSocketUrl(baseUrl: string, path: string): string {
  if (baseUrl === "/" || baseUrl === "") {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:"
    return `${protocol}//${location.host}${path}`
  }
  const url = new URL(baseUrl)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return `${url.origin}${path}`
}

function getTerminalTheme() {
  const style = getComputedStyle(document.documentElement)
  const get = (prop: string) => style.getPropertyValue(prop).trim()
  return {
    background: get("--terminal-background") || "#011627",
    foreground: get("--terminal-foreground") || "#d6deeb",
    cursor: get("--terminal-cursor") || "#82aaff",
    black: get("--terminal-black") || "#011627",
    red: get("--terminal-red") || "#ef5350",
    green: get("--terminal-green") || "#c5e478",
    yellow: get("--terminal-yellow") || "#ecc48d",
    blue: get("--terminal-blue") || "#82aaff",
    magenta: get("--terminal-magenta") || "#c792ea",
    cyan: get("--terminal-cyan") || "#7fdbca",
    white: get("--terminal-white") || "#d6deeb",
    brightBlack: get("--terminal-bright-black") || "#5f7e97",
    brightRed: get("--terminal-bright-red") || "#ff7875",
    brightGreen: get("--terminal-bright-green") || "#d4ed8c",
    brightYellow: get("--terminal-bright-yellow") || "#f2d4a8",
    brightBlue: get("--terminal-bright-blue") || "#9dbfff",
    brightMagenta: get("--terminal-bright-magenta") || "#d4a8f0",
    brightCyan: get("--terminal-bright-cyan") || "#7fdbca",
    brightWhite: get("--terminal-bright-white") || "#ffffff",
  }
}

type TerminalSnapshot = {
  buffer?: string
  cols?: number
  rows?: number
  scrollY?: number
}

function getThemeSnapshot(term?: Term, serializeAddon?: SerializeAddon): TerminalSnapshot | undefined {
  if (!term || !serializeAddon) return
  return {
    buffer: serializeAddon.serialize(),
    cols: term.cols,
    rows: term.rows,
    scrollY: term.getViewportY(),
  }
}

export interface TerminalProps extends ComponentProps<"div"> {
  pty: LocalPTY
  onSubmit?: () => void
  onCleanup?: (pty: LocalPTY) => void
  onConnectError?: (error: unknown) => void
}

export const Terminal = (props: TerminalProps) => {
  const sdk = useSDK()
  let container!: HTMLDivElement
  let mobileInputRef: HTMLInputElement | undefined
  const [local, others] = splitProps(props, ["pty", "class", "classList", "onConnectError"])
  const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches
  const isTouchDevice = "ontouchstart" in window
  const isMobileInputEnabled = isCoarsePointer || isTouchDevice
  const [socket, setSocket] = createSignal<WebSocket | undefined>()
  const [terminalColors, setTerminalColors] = createSignal(getTerminalTheme())
  let isMounted = true
  let ws: WebSocket
  let term: Term
  let ghostty: Ghostty
  let serializeAddon: SerializeAddon
  let fitAddon: FitAddon
  let handleResize: () => void
  let themeObserver: MutationObserver
  let onTerminalThemeChange: () => void
  let pendingThemeRefresh: number | undefined

  const focusTerminal = () => term?.focus()
  const copySelection = () => {
    if (!term || !term.hasSelection()) return false
    const selection = term.getSelection()
    if (!selection) return false
    const clipboard = navigator.clipboard
    if (clipboard?.writeText) {
      clipboard.writeText(selection).catch(() => {})
      return true
    }
    if (!document.body) return false
    const textarea = document.createElement("textarea")
    textarea.value = selection
    textarea.setAttribute("readonly", "")
    textarea.style.position = "fixed"
    textarea.style.opacity = "0"
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand("copy")
    document.body.removeChild(textarea)
    return copied
  }
  const handlePointerDown = () => {
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement && activeElement !== container) {
      activeElement.blur()
    }
    focusTerminal()
  }

  onMount(async () => {
    ghostty = await Ghostty.load()
    if (!isMounted) return

    const wsUrl = getWebSocketUrl(
      sdk.url,
      `/pty/${local.pty.id}/connect?directory=${encodeURIComponent(sdk.directory)}`,
    )
    ws = new WebSocket(wsUrl)
    setSocket(ws)

    const buildTerminal = (snapshot?: TerminalSnapshot) => {
      if (!isMounted) return
      const theme = getTerminalTheme()
      setTerminalColors(theme)
      term = new Term({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: "meslo, Menlo, Monaco, Courier New, monospace",
        allowTransparency: true,
        theme,
        scrollback: 10_000,
        ghostty,
      })
      term.attachCustomKeyEventHandler((event) => {
        const key = event.key.toLowerCase()
        if (key === "c") {
          const macCopy = event.metaKey && !event.ctrlKey && !event.altKey
          const linuxCopy = event.ctrlKey && event.shiftKey && !event.metaKey
          if ((macCopy || linuxCopy) && copySelection()) {
            event.preventDefault()
            return true
          }
        }
        if (event.ctrlKey && key === "`") {
          event.preventDefault()
          return true
        }
        return false
      })

      fitAddon = new FitAddon()
      serializeAddon = new SerializeAddon()
      term.loadAddon(serializeAddon)
      term.loadAddon(fitAddon)

      term.open(container)
      container.addEventListener("pointerdown", handlePointerDown)
      focusTerminal()

      if (snapshot?.cols && snapshot?.rows) {
        term.resize(snapshot.cols, snapshot.rows)
      }

      if (snapshot?.buffer !== undefined) {
        term.reset()
        term.write(snapshot.buffer)
        if (typeof snapshot.scrollY === "number") {
          term.scrollToLine(snapshot.scrollY)
        }
      }

      fitAddon.observeResize()
      fitAddon.fit()

      term.onResize(async (size) => {
        if (!isMounted) return
        if (ws && ws.readyState === WebSocket.OPEN) {
          await sdk.client.pty.update({
            ptyID: local.pty.id,
            size: {
              cols: size.cols,
              rows: size.rows,
            },
          })
        }
      })
      term.onData((data) => {
        if (!isMounted) return
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(data)
        }
      })
      term.onKey((key) => {
        if (!isMounted) return
        if (key.key == "Enter") {
          props.onSubmit?.()
        }
      })

      container.focus()
    }

    buildTerminal({
      buffer: local.pty.buffer,
      cols: local.pty.cols,
      rows: local.pty.rows,
      scrollY: local.pty.scrollY,
    })

    handleResize = () => fitAddon.fit()
    window.addEventListener("resize", handleResize)

    const refreshTerminalTheme = () => {
      if (pendingThemeRefresh) {
        cancelAnimationFrame(pendingThemeRefresh)
      }
      pendingThemeRefresh = requestAnimationFrame(() => {
        pendingThemeRefresh = undefined
        const snapshot = getThemeSnapshot(term, serializeAddon) ?? {}
        term?.dispose()
        fitAddon?.dispose()
        buildTerminal(snapshot)
        fitAddon.fit()
      })
    }

    onTerminalThemeChange = () => refreshTerminalTheme()

    themeObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === "data-theme") {
          refreshTerminalTheme()
        }
      }
    })
    themeObserver.observe(document.documentElement, { attributes: true })
    document.documentElement.addEventListener("terminal-theme-changed", onTerminalThemeChange)
    ws.addEventListener("open", () => {
      if (!isMounted) return
      console.log("WebSocket connected")
      sdk.client.pty
        .update({
          ptyID: local.pty.id,
          size: {
            cols: term.cols,
            rows: term.rows,
          },
        })
        .catch(() => {})
    })
    ws.addEventListener("message", (event) => {
      if (!isMounted) return
      term.write(event.data)
    })
    ws.addEventListener("error", (error) => {
      if (!isMounted) return
      console.error("WebSocket error:", error)
      props.onConnectError?.(error)
    })
    ws.addEventListener("close", () => {
      if (!isMounted) return
      console.log("WebSocket disconnected")
    })
  })

  onCleanup(() => {
    isMounted = false
    if (pendingThemeRefresh) {
      cancelAnimationFrame(pendingThemeRefresh)
    }
    if (handleResize) {
      window.removeEventListener("resize", handleResize)
    }
    container.removeEventListener("pointerdown", handlePointerDown)
    if (onTerminalThemeChange) {
      document.documentElement.removeEventListener("terminal-theme-changed", onTerminalThemeChange)
    }
    themeObserver?.disconnect()
    const savedSnapshot =
      serializeAddon && term
        ? {
            buffer: serializeAddon.serialize(),
            rows: term.rows,
            cols: term.cols,
            scrollY: term.getViewportY(),
          }
        : undefined
    if (savedSnapshot && props.onCleanup) {
      props.onCleanup({
        ...local.pty,
        ...savedSnapshot,
      })
    }
    ws?.close()
    term?.dispose()
  })

  const handleContainerClick = () => {
    if (isMobileInputEnabled && mobileInputRef) {
      mobileInputRef.focus()
    }
  }

  return (
    <div
      ref={container}
      data-component="terminal"
      data-prevent-autofocus
      style={{ "background-color": terminalColors().background }}
      classList={{
        ...(local.classList ?? {}),
        "select-text": true,
        "size-full px-3 sm:px-6 py-3 font-mono relative": true,
        [local.class ?? ""]: !!local.class,
      }}
      onClick={handleContainerClick}
      {...others}
    >
      <Show when={isMobileInputEnabled}>
        <MobileTerminalInput ref={(el) => (mobileInputRef = el)} socket={socket()} enabled={isMounted} />
      </Show>
    </div>
  )
}
