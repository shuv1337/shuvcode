import { expect, sourceURL, story } from "../../stories/playwright/story"

const fixture = sourceURL(new URL("../../gui-plugins/src/file/find.fixture.tsx", import.meta.url))

for (const frame of [false, true]) {
  story(`preview find retains original Unicode offsets in ${frame ? "HTML" : "documents"}`, async ({ mount, page }) => {
    await mount("current-session-terminal-work--user-command-completed")
    await page.evaluate(
      async ({ fixture, frame }) => {
        const { mountPreviewFind } = await import(fixture)
        mountPreviewFind(frame)
      },
      { fixture, frame },
    )
    const host = page.getByTestId("preview-find-fixture")
    const text = frame ? host.frameLocator("iframe").locator("p") : host.locator("p")
    await expect(text).toHaveText("İx A.b a.b 𐐀")
    await host.getByRole("button", { name: "Open preview find" }).click()

    for (const [query, matches] of [
      ["x", ["x"]],
      ["a.b", ["A.b", "a.b"]],
      ["𐐨", ["𐐀"]],
    ] as const) {
      await host.getByRole("textbox", { name: "Preview query" }).fill(query)
      await expect(host.getByLabel("Match count")).toHaveText(String(matches.length))
      expect(
        await text.evaluate((node, frame) => {
          const key = frame ? "opencode-file-find" : "file-preview-find"
          return [CSS.highlights.get(key), CSS.highlights.get(key + "-current")]
            .flatMap((highlight) => (highlight ? Array.from(highlight, (range) => range.toString()) : []))
            .sort()
        }, frame),
      ).toEqual([...matches].sort())
    }
    await host.getByRole("textbox", { name: "Preview query" }).fill("")
    await expect(host.getByLabel("Match count")).toHaveText("0")
  })
}
