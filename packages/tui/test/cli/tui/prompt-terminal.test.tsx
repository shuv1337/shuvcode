import { expect, test } from "bun:test"
import { createAppFixture } from "../../fixture/app"
import { json } from "../../fixture/tui-client"
import { tmpdir } from "../../fixture/fixture"

test.each(["available", "missing"])("@terminal submission with %s built-in terminal", async (terminal) => {
  await using state = await tmpdir()
  const cwd = process.cwd()
  const location = { directory: cwd, project: { id: "project", directory: cwd, canonical: cwd } }
  const session = {
    id: "ses_terminal",
    title: "Terminal fixture",
    projectID: "project",
    location: { directory: cwd },
    agent: "build",
    model: { providerID: "provider", id: "model" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const reads: URL[] = []
  const submitted: unknown[] = []
  const firstPrompt = Promise.withResolvers<void>()
  const terminalRead = Promise.withResolvers<void>()
  const terminalPrompt = Promise.withResolvers<void>()
  await using setup = await createAppFixture({
    state: state.path,
    args: { sessionID: session.id },
    config: { animations: false, tabs: { mode: "off" } },
    fetch: async (url, request) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`) return json({ data: [], cursor: {} })
      if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
      if (url.pathname === `/api/session/${session.id}/permission`) return json({ data: [] })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "provider", name: "Model", variants: [] }] })
      if (url.pathname === "/api/fs/find") return json({ location, data: [] })
      if (url.pathname === `/api/experimental/session/${session.id}/terminal/read`) {
        reads.push(url)
        terminalRead.resolve()
        return json({
          data:
            terminal === "available"
              ? {
                  ptyID: "pty_current",
                  title: "Built-in terminal",
                  cwd,
                  foregroundProcess: "bun test",
                  screen: { text: "FROZEN OUTPUT\n", cols: 80, rows: 24, cursor: { x: 0, y: 1 } },
                }
              : null,
        })
      }
      if (url.pathname === `/api/session/${session.id}/prompt`) {
        submitted.push(await request.json())
        if (submitted.length === 1) firstPrompt.resolve()
        if (submitted.length === 2) terminalPrompt.resolve()
        return json({ data: {} })
      }
      return undefined
    },
  })

  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Build · Model Provider"))
  await setup.mockInput.typeText("ordinary question")
  setup.mockInput.pressEnter()
  await Promise.race([
    firstPrompt.promise,
    Bun.sleep(2_000).then(() => {
      throw new Error("ordinary prompt not submitted")
    }),
  ])
  expect(reads).toHaveLength(0)
  expect(submitted[0]).toMatchObject({ text: "ordinary question" })

  await setup.mockInput.typeText("Explain @term")
  await setup.waitForFrame(
    (frame) => frame.includes("@terminal") && frame.includes("Current session terminal snapshot"),
  )
  setup.mockInput.pressEnter() // select the tracked autocomplete mention
  await setup.waitForFrame(
    (frame) => frame.includes("Explain @terminal") && !frame.includes("Current session terminal snapshot"),
  )
  expect(reads).toHaveLength(0)
  setup.mockInput.pressEnter()
  await Promise.race([
    terminalRead.promise,
    Bun.sleep(2_000).then(() => {
      throw new Error("terminal was not read")
    }),
  ])
  expect(reads).toHaveLength(1)
  expect(reads[0]?.searchParams.get("lines")).toBe("80")

  if (terminal === "missing") {
    const frame = await setup.waitForFrame(
      (frame) => frame.includes("Explain @terminal") && frame.includes("Failed to attach terminal"),
    )
    expect(frame).toContain("Explain @terminal")
    expect(submitted).toHaveLength(1)
    return
  }

  await Promise.race([
    terminalPrompt.promise,
    Bun.sleep(2_000).then(() => {
      throw new Error("terminal prompt not submitted")
    }),
  ])
  expect(submitted).toHaveLength(2)
  const prompt = submitted[1] as { text: string; files: Array<{ uri: string; name: string }> }
  expect(prompt.text).toContain("Explain @terminal")
  expect(prompt.files).toHaveLength(1)
  expect(prompt.files[0]?.name).toBe("session-terminal-snapshot.txt")
  const snapshot = Buffer.from(prompt.files[0]!.uri.slice("data:text/plain;base64,".length), "base64").toString("utf8")
  expect(snapshot).toContain("Terminal ID: pty_current")
  expect(snapshot).toContain("FROZEN OUTPUT")
})
