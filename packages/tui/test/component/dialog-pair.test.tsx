/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { base64Encode } from "@opencode/util/encode"
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

test("shows the upstream /connect pairing link with the password hidden until revealed", async () => {
  const app = await renderPair(["http://192.168.1.5:4919"])

  try {
    await app.waitForFrame((frame) => frame.includes("Link"))
    const frame = app.captureCharFrame()
    expect(details(frame)).toContain("http://192.168.1.5:4919/connect#************")
    expect(frame).toContain("█")

    const rows = frame.split("\n")
    const line = rows.findIndex((row) => row.includes("Link")) + 1
    await app.mockMouse.click(rows[line]!.indexOf("http") + 1, line)
    const hash = base64Encode(JSON.stringify({ username: "opencode", password: "secret" }))
    await app.waitForFrame((next) => details(next).includes(`http://192.168.1.5:4919/connect#${hash}`))
  } finally {
    app.renderer.destroy()
  }
})

test("omits the pairing link and QR code when the server reports no URLs", async () => {
  const app = await renderPair([])

  try {
    await app.waitForFrame((frame) => frame.includes("Password"))
    const frame = app.captureCharFrame()
    expect(frame).not.toContain("Link")
    expect(frame).not.toContain("█")
  } finally {
    app.renderer.destroy()
  }
})

// Joins the wrapped left details column so values split across lines can be matched whole.
function details(frame: string) {
  const rows = frame.split("\n")
  const column = rows.find((row) => row.includes("Username"))!.indexOf("Username")
  return rows.map((row) => row.slice(column, column + 29).trim()).join("")
}

async function renderPair(urls: string[]) {
  const calls = createFetch((url) => {
    if (url.pathname === "/api/info") return json({ version: "0.0.0", pid: 1, urls, paths: { tmp: "/tmp" } })
    return undefined
  })

  function Probe() {
    const dialog = useDialog()
    onMount(() => dialog.replace(() => <DialogPair credentials={{ username: "opencode", password: "secret" }} />))
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
