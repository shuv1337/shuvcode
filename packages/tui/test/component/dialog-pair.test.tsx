/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onMount } from "solid-js"
import { DialogPair } from "../../src/component/dialog-pair"
import { ConfigProvider } from "../../src/config"
import { ClientProvider } from "../../src/context/client"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource } from "../fixture/fixture"
import { createApi, createFetch, json } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

test("shows one-time connect links and a QR code", async () => {
  const app = await renderPair(["http://192.168.1.5:4919"])

  try {
    await app.waitForFrame((frame) => frame.includes("Links"))
    const frame = app.captureCharFrame()
    const text = leftColumn(frame).replace(/\s+/g, "")
    expect(text).toContain("http://192.168.1.5:4919/auth/connect/once")
    expect(text).toContain("http://localhost:4919/auth/connect/once")
    expect(text).toContain("expirein5minutes")
    expect(frame).toContain("█")
    expect(leftColumn(frame)).not.toContain("shuvcode")
  } finally {
    app.renderer.destroy()
  }
})

test("tells loopback servers to open the service with the shuvcode command", async () => {
  const app = await renderPair(["http://127.0.0.1:4919"])

  try {
    await app.waitForFrame((frame) => frame.includes("shuvcode"))
    const frame = app.captureCharFrame()
    const text = leftColumn(frame).replace(/\s+/g, "")
    expect(text).toContain("http://127.0.0.1:4919/auth/connect/once")
    expect(text).toContain("shuvcodeservicesethostname0.0.0.0")
  } finally {
    app.renderer.destroy()
  }
})

test("omits connect links and the QR code when the server reports no URLs", async () => {
  const app = await renderPair([])

  try {
    await app.waitForFrame((frame) => frame.includes("Links"))
    const frame = app.captureCharFrame()
    expect(frame).not.toContain("/auth/connect/")
    expect(frame).not.toContain("█")
  } finally {
    app.renderer.destroy()
  }
})

// The QR sits in the right column, so collapsed full-frame text mixes it into wrapped URLs.
function leftColumn(frame: string) {
  const rows = frame.split("\n")
  const column = rows.find((row) => row.includes("Pair"))!.indexOf("Pair")
  return rows.map((row) => row.slice(column, column + 29).trim()).join("")
}

async function renderPair(urls: string[]) {
  const calls = createFetch((url, request) => {
    if (url.pathname === "/api/info") return json({ version: "0.0.0", pid: 1, urls, paths: { tmp: "/tmp" } })
    if (url.pathname === "/api/pair" && request.method === "POST") return json({ code: "once", expires_in: 300 })
    return undefined
  })

  function Probe() {
    const dialog = useDialog()
    onMount(() => dialog.replace(() => <DialogPair />))
    return null
  }

  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <Keymap.Provider>
            <ToastProvider>
              <ClientProvider api={createApi(calls.fetch)}>
                <ThemeProvider mode="dark" source={emptyThemeSource}>
                  <DialogProvider>
                    <Probe />
                  </DialogProvider>
                </ThemeProvider>
              </ClientProvider>
            </ToastProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 120, height: 48 },
  )
  app.renderer.start()
  return app
}
