import { expect, test } from "bun:test"
import type { ConfigEntry } from "@opencode/client"
import { createAppFixture } from "./fixture/app"
import { json } from "./fixture/tui-client"

test("config errors appear once, persist without repeat toasts on config.updated, and refresh after repair", async () => {
  const diagnostic = {
    source: "/config/opencode.json",
    path: "$",
    line: 3,
    column: 2,
    message: "File ignored: CloseBraceExpected",
  }
  const other = {
    source: "/config/other.json",
    path: "$.snapshots",
    message: "Skipped invalid setting: Expected boolean",
  }
  let entries: ConfigEntry[] = [
    {
      type: "document",
      info: {},
      experimental: {
        diagnostics: [diagnostic, other],
      },
    },
  ]
  const requests: string[] = []
  await using setup = await createAppFixture({
    width: 100,
    height: 35,
    fetch: (url) => {
      if (url.pathname !== "/api/config") return
      requests.push(url.searchParams.get("location[directory]")!)
      return json(entries)
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Invalid configuration"))
  expect(setup.captureCharFrame()).toContain("opencode.json:3:2")
  expect(setup.captureCharFrame()).toContain("CloseBraceExpected")
  const lines = setup.captureCharFrame().split("\n")
  const row = lines.findIndex((line) => line.includes("View diagnostics"))
  await setup.mockMouse.click(lines[row]!.indexOf("View diagnostics"), row)
  await setup.waitForFrame((frame) => frame.includes("Configuration errors"))
  expect(setup.captureCharFrame()).toContain("Fix the file")
  expect(setup.captureCharFrame()).toContain("other.json")
  // The same diagnostics in a new order force a refresh we can observe in Status.
  // Neither unchanged error should toast again.
  entries = [{ type: "document", info: {}, experimental: { diagnostics: [other, diagnostic] } }]
  setup.events.emit({
    id: "evt_unchanged",
    created: 1,
    type: "config.updated",
    location: { directory: requests[0]! },
    data: {},
  })
  await setup.waitForFrame(
    (frame) => frame.includes("other.json") && frame.indexOf("other.json") < frame.indexOf("opencode.json:3:2"),
  )
  expect(setup.captureCharFrame()).toContain("CloseBraceExpected")
  expect(setup.captureCharFrame()).not.toContain("Invalid configuration")
  expect(setup.captureCharFrame()).not.toContain("View diagnostics")
  setup.resize(44, 35)
  await setup.renderOnce()
  expect(setup.captureCharFrame()).toContain("Configuration errors")
  expect(setup.captureCharFrame()).toContain("CloseBraceExpected")

  entries = [{ type: "document", info: {} }]
  setup.events.emit({
    id: "evt_fixed",
    created: 2,
    type: "config.updated",
    location: { directory: requests[0]! },
    data: {},
  })
  await setup.waitForFrame((frame) => !frame.includes("Configuration errors"))
  expect(setup.captureCharFrame()).not.toContain("CloseBraceExpected")
  setup.mockInput.pressEscape()
  setup.resize(100, 35)
  entries = [{ type: "document", info: {}, experimental: { diagnostics: [diagnostic] } }]
  setup.events.emit({
    id: "evt_broken",
    created: 3,
    type: "config.updated",
    location: { directory: requests[0]! },
    data: {},
  })
  await setup.waitForFrame((frame) => frame.includes("Invalid configuration"))
  expect(setup.captureCharFrame()).toContain("CloseBraceExpected")
})
