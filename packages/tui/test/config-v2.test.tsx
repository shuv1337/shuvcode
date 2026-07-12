/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import {
  resolve,
  TuiConfigProvider,
  useTuiConfig,
  useTuiConfigService,
  type Interface,
} from "../src/config"

test("resolves nested config and keybind defaults", () => {
  const config = resolve(
    {
      keybinds: { leader: "ctrl+o" },
      leader: { timeout: 500 },
      scroll: { speed: 2, acceleration: true },
      diffs: { view: "split" },
    },
    { terminalSuspend: true },
  )

  expect(config.leader.timeout).toBe(500)
  expect(config.keybinds.get("leader")?.[0]?.key).toBe("ctrl+o")
  expect(config.scroll).toEqual({ speed: 2, acceleration: true })
  expect(config.diffs).toEqual({ view: "split" })
})

test("provides config and its host interface", async () => {
  const config = resolve({}, { terminalSuspend: true })
  let current = {}
  const service: Interface = {
    get: async () => current,
    update: async (update) => {
      const draft: Record<string, any> = { ...current }
      update(draft)
      current = draft
      return draft
    },
  }
  let configService: Interface | undefined

  function Consumer() {
    const config = useTuiConfig()
    configService = useTuiConfigService()
    return <text>{`${config.mouse ? "mouse" : "none"} ${config.keybinds.get("leader")?.[0]?.key}`}</text>
  }

  const app = await testRender(() => (
    <TuiConfigProvider config={config} service={service}>
      <Consumer />
    </TuiConfigProvider>
  ))
  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("mouse ctrl+x")
    if (!configService) throw new Error("Config service was not provided")
    await configService.update((draft) => {
      draft.mouse = false
      draft.keybinds = { leader: "ctrl+o" }
    })
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("none ctrl+o")
  } finally {
    app.renderer.destroy()
  }
})
