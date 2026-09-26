/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { ConfigProvider } from "../../src/config"
import { ClientProvider } from "../../src/context/client"
import { DataProvider, useData } from "../../src/context/data"
import { TuiAppProvider } from "../../src/context/runtime"
import { SessionTerminalsProvider, useSessionTerminals } from "../../src/context/session-terminals"
import { StorageProvider, useStorage } from "../../src/context/storage"
import { tmpdir } from "../fixture/fixture"
import { createApi, createEventStream, createFetch, directory, json } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

test.each([
  { shell: "zsh", command: "zsh", label: "zsh" },
  { shell: "system", command: undefined, label: "system default" },
  { shell: undefined, command: undefined, label: "unset preference" },
])("creates a built-in terminal with $label", async ({ shell, command }) => {
  await using state = await tmpdir()
  const sessionID = "ses_terminal_shell"
  const pty = {
    id: "pty_terminal_shell",
    sessionID,
    title: "Terminal",
    command: command ?? "/bin/bash",
    args: [],
    cwd: directory,
    status: "running",
    pid: 1,
    foregroundProcess: null,
    size: { cols: 80, rows: 24 },
    output: { head: 0, tail: 0 },
  }
  const requests: unknown[] = []
  const calls = createFetch((url, request) => {
    if (url.pathname === `/api/session/${sessionID}`)
      return json({
        data: {
          id: sessionID,
          projectID: "project",
          location: { directory },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 0, updated: 0 },
        },
      })
    if (url.pathname !== `/api/experimental/session/${sessionID}/terminal`) return undefined
    if (request.method === "GET") return json({ data: [pty] })
    return request.json().then((payload) => {
      requests.push(payload)
      return json({ data: pty })
    })
  }, createEventStream())
  let terminals!: ReturnType<typeof useSessionTerminals>
  let data!: ReturnType<typeof useData>
  let storage!: ReturnType<typeof useStorage>

  function Probe() {
    terminals = useSessionTerminals()
    data = useData()
    storage = useStorage()
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts paths={{ state: state.path }}>
      <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
        <StorageProvider>
          <ConfigProvider config={createTuiResolvedConfig({ terminal: shell ? { shell } : undefined })}>
            <ClientProvider api={createApi(calls.fetch)}>
              <DataProvider directory={directory}>
                <SessionTerminalsProvider>
                  <Probe />
                </SessionTerminalsProvider>
              </DataProvider>
            </ClientProvider>
          </ConfigProvider>
        </StorageProvider>
      </TuiAppProvider>
    </TestTuiContexts>
  ))

  try {
    await data.session.sync(sessionID)
    expect((await terminals.newTerminal(sessionID)).id).toBe(pty.id)
    expect(requests).toEqual([
      {
        ...(command ? { command } : {}),
        args: [],
        cwd: directory,
        title: "Terminal",
        env: {},
      },
    ])
    expect(terminals.get(sessionID).selectedTerminalID).toBe(pty.id)
  } finally {
    app.renderer.destroy()
    await storage.flush()
  }
})
