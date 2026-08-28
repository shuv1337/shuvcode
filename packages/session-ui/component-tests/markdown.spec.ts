import { fileURLToPath } from "node:url"
import { expect, story } from "../../storybook/playwright/story"

const fixture = `/@fs/${fileURLToPath(new URL("./markdown.fixture.tsx", import.meta.url)).replaceAll("\\", "/")}`

story.beforeEach(async ({ mount }) => {
  const root = await mount("components-markdown--complete-response")
  await expect(root.locator('[data-component="markdown"]')).toHaveAttribute("data-markdown-ready", "")
})

story("sanitizes raw HTML while preserving supported Markdown markup", async ({ page }) => {
  const result = await page.evaluate(async (fixture) => {
    const { sanitizeMarkdown } = await import(fixture)
    return [
      "<p><strong>Safe</strong> <em>formatting</em> <code>const x = 1</code></p>",
      '<script>alert(1)</script><style>body { display: none }</style><img src="safe.png" onerror="alert(2)"><a href="java&#x73;cript:alert(3)">unsafe</a>',
      '<a href="https://example.com" target="_blank" rel="nofollow">external</a><a href="/local">local</a>',
      '<form id="location" name="document"><input name="cookie"></form>',
      "<math><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow></math>",
      '<svg viewBox="0 0 10 10"><path d="M0 0L10 10" onload="alert(4)"></path><script>alert(5)</script></svg>',
    ].map(sanitizeMarkdown)
  }, fixture)
  expect(result).toEqual([
    "<p><strong>Safe</strong> <em>formatting</em> <code>const x = 1</code></p>",
    '<img src="safe.png"><a>unsafe</a>',
    '<a href="https://example.com" target="_blank" rel="nofollow noopener noreferrer">external</a><a href="/local">local</a>',
    '<form name="user-content-document" id="user-content-location"><input name="user-content-cookie"></form>',
    "<math><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow></math>",
    '<svg viewBox="0 0 10 10"><path d="M0 0L10 10"></path></svg>',
  ])
})

story("keeps Markdown sanitization and link protections after Mermaid renders", async ({ page }) => {
  const result = await page.evaluate(async (fixture) => {
    const { renderMermaidSvg, sanitizeMarkdown } = await import(fixture)
    const html =
      '<a href="https://example.com" target="_blank" rel="nofollow">external</a><img src="safe.png" onerror="alert(1)">'
    const before = sanitizeMarkdown(html)
    const renders = []
    for (const source of [
      "flowchart LR\n A[Start] --> B[End]",
      "sequenceDiagram\n Alice->>Bob: Hello",
      '%%{init: {"flowchart": {"htmlLabels": true}}}%%\nflowchart LR\n A["<a href=\'https://example.com\' target=\'_blank\'>External</a>"] --> B[End]',
    ]) {
      const svg = await renderMermaidSvg(source)
      const document = new DOMParser().parseFromString(svg, "image/svg+xml")
      renders.push({
        root: document.documentElement.localName,
        text: document.documentElement.textContent,
        unsafe: document.querySelectorAll('script, [onerror], [onload], [href^="javascript:"]').length,
        links: Array.from(document.querySelectorAll("a")).map((link) => ({
          href: link.getAttribute("href"),
          target: link.getAttribute("target"),
          rel: link.getAttribute("rel"),
        })),
        markdown: sanitizeMarkdown(html),
      })
    }
    return {
      before,
      renders,
      invalid: await renderMermaidSvg("not a diagram"),
      afterInvalid: sanitizeMarkdown(html),
    }
  }, fixture)
  expect(result.before).toBe(
    '<a href="https://example.com" target="_blank" rel="nofollow noopener noreferrer">external</a><img src="safe.png">',
  )
  expect(result.renders).toEqual([
    { root: "svg", text: expect.stringContaining("Start"), unsafe: 0, links: [], markdown: result.before },
    { root: "svg", text: expect.stringContaining("Hello"), unsafe: 0, links: [], markdown: result.before },
    {
      root: "svg",
      text: expect.stringContaining("External"),
      unsafe: 0,
      links: [{ href: "https://example.com", target: "_blank", rel: "noopener" }],
      markdown: result.before,
    },
  ])
  expect(result.invalid).toBeUndefined()
  expect(result.afterInvalid).toBe(result.before)
})

story("mounts cached completed Markdown with sanitized HTML and decorations", async ({ page }) => {
  await page.evaluate(
    async ({ fixture, text }) => {
      const { mountMarkdown } = await import(fixture)
      await mountMarkdown({ text, cached: true })
    },
    {
      fixture,
      text: [
        "# Completed response",
        "`src/file.ts` and `https://example.com/docs` and [link](https://example.com)",
        '<img src="missing" onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">unsafe</a>',
        "```ts\nconst answer = 42\n```",
      ].join("\n\n"),
    },
  )
  const harness = page.getByTestId("markdown-fixture")
  const markdown = harness.locator('[data-component="markdown"]')
  await expect(markdown).toHaveAttribute("data-markdown-ready", "")
  await expect(markdown.getByRole("heading")).toHaveText("Completed response")
  await expect(markdown.locator("script, [onerror], [href^='javascript:']")).toHaveCount(0)
  await expect(markdown.locator('code[data-inline-code-kind="path"]')).toHaveText("src/file.ts")
  await expect(markdown.getByRole("link", { name: "https://example.com/docs" })).toHaveAttribute("target", "_blank")
  await expect(markdown.getByRole("link", { name: "https://example.com/docs" })).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  )
  await expect(markdown.locator("pre code")).toContainText("const answer = 42")
  await expect(markdown.getByRole("button", { name: "Copy", exact: true })).toBeVisible()
  await expect(markdown.locator("[data-markdown-word]")).toHaveCount(0)

  await harness.getByLabel("Markdown text").fill("## Replacement\n\n`new/file.ts`")
  await expect(markdown.getByRole("heading")).toHaveText("Replacement")
  await expect(markdown).toHaveAttribute("data-markdown-ready", "")
  await expect(markdown.locator("pre, h1, a")).toHaveCount(0)
  await expect(markdown.locator('code[data-inline-code-kind="path"]')).toHaveText("new/file.ts")
  await harness.getByRole("button", { name: "Toggle Markdown" }).click()
  await expect(markdown).toHaveCount(0)
  await harness.getByRole("button", { name: "Toggle Markdown" }).click()
  await expect(markdown.getByRole("heading")).toHaveText("Replacement")
  await expect(markdown).toHaveAttribute("data-markdown-ready", "")
  await harness.getByLabel("Markdown text").fill("")
  await expect(markdown).toBeEmpty()
  await expect(markdown).toHaveAttribute("data-markdown-ready", "")
})

story("renders cached Mermaid blocks and falls back to code for invalid diagrams", async ({ page }) => {
  await page.evaluate(async (fixture) => {
    const { mountMarkdown } = await import(fixture)
    await mountMarkdown({ text: "```mermaid\nflowchart LR\n A[Start] --> B[End]\n```", cached: true })
  }, fixture)
  const harness = page.getByTestId("markdown-fixture")
  const markdown = harness.locator('[data-component="markdown"]')
  await expect(markdown.locator('[data-component="markdown-mermaid"] > svg')).toBeVisible()
  await harness.getByRole("button", { name: "Toggle Markdown" }).click()
  await expect(markdown).toHaveCount(0)
  await harness.getByRole("button", { name: "Toggle Markdown" }).click()
  await expect(markdown.locator('[data-component="markdown-mermaid"] > svg')).toBeVisible()
  await harness.getByLabel("Markdown text").fill("```mermaid\nnot a diagram\n```")
  await expect(markdown.locator('[data-component="markdown-mermaid"]')).toHaveCount(0)
  await expect(markdown.locator("pre code")).toBeVisible()
  await expect(markdown.locator("pre code")).toHaveText("not a diagram")
  await expect(markdown.getByRole("button", { name: "Copy", exact: true })).toBeVisible()
})

story("keeps live elements and selection when a stream completes and later changes", async ({ page }) => {
  await page.evaluate(async (fixture) => {
    const { mountMarkdown } = await import(fixture)
    await mountMarkdown({ text: "Hello **world**", streaming: true })
  }, fixture)
  const harness = page.getByTestId("markdown-fixture")
  const markdown = harness.locator('[data-component="markdown"]')
  const paragraph = markdown.locator("p")
  await expect(markdown.locator("[data-markdown-word]")).toHaveCount(2)
  await paragraph.evaluate((element) => element.setAttribute("data-retained", "true"))
  await harness.getByLabel("Markdown text").fill("Hello **world** again")
  await expect(markdown.locator("[data-markdown-word]")).toHaveCount(3)
  await expect(paragraph).toHaveAttribute("data-retained", "true")
  await expect(markdown.locator("[data-markdown-enter]")).not.toHaveCount(0)
  await paragraph.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element.querySelector("strong")!)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    // Change the control without moving browser focus or selection.
    const input = document.querySelector<HTMLInputElement>('[data-testid="markdown-fixture"] input')!
    input.checked = false
    input.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await expect(harness.getByLabel("Streaming")).not.toBeChecked()
  await expect(markdown).toHaveAttribute("data-markdown-ready", "")
  await expect(paragraph).toHaveAttribute("data-retained", "true")
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("world")
  await harness.getByLabel("Markdown text").fill("Changed **content**")
  await expect(paragraph).toHaveText("Changed content")
  await expect(paragraph).toHaveAttribute("data-retained", "true")
  await expect(markdown.locator("[data-markdown-word]")).toHaveCount(0)
  await harness.getByRole("button", { name: "Toggle Markdown" }).click()
  await expect(markdown).toHaveCount(0)
})

story("replaces completed DOM before live rendering and retains streamed code copy actions", async ({ page }) => {
  await page.evaluate(async (fixture) => {
    const { mountMarkdown } = await import(fixture)
    await mountMarkdown({ text: "Initial **content**" })
  }, fixture)
  const harness = page.getByTestId("markdown-fixture")
  const markdown = harness.locator('[data-component="markdown"]')
  await expect(markdown.locator("p")).toHaveText("Initial content")
  await harness.getByLabel("Streaming").check()
  await harness.getByLabel("Markdown text").fill("Initial **content** continues")
  await expect(markdown.locator("p")).toHaveCount(1)
  await expect(markdown.locator("[data-markdown-word]")).toHaveCount(3)
  await harness.getByLabel("Markdown text").fill("```sh\necho hello\n")
  await expect(markdown.locator("pre code")).toHaveText("echo hello\n")
  await expect(markdown.locator("p")).toHaveCount(0)
  await expect(markdown.locator('[data-component="markdown-code"]')).toHaveAttribute("data-code-kind", "shell")
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
  await markdown.getByRole("button", { name: "Copy" }).click()
  await expect(markdown.getByRole("button", { name: "Copied" })).toBeVisible()
  expect((await page.evaluate(() => navigator.clipboard.readText())).replaceAll("\r\n", "\n")).toBe("echo hello\n")
  await harness.getByLabel("Streaming").uncheck()
  await expect(markdown.locator("[data-markdown-complete]")).toHaveAttribute("data-markdown-complete", "true")
  await expect(markdown.locator("pre code")).toHaveText("echo hello\n")
  await harness.getByLabel("Markdown text").fill("Replacement prose")
  await expect(markdown.locator("p")).toHaveText("Replacement prose")
  await expect(markdown.locator('pre, [data-slot="markdown-copy-button"]')).toHaveCount(0)
  await harness.getByRole("button", { name: "Toggle Markdown" }).click()
  await expect(markdown).toHaveCount(0)
})
