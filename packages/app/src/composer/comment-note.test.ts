import { describe, expect, test } from "bun:test"
import { commentContextItem, formatBrowserCommentNote, readPromptPresentation } from "./comment-note"

const browser = {
  type: "browser" as const,
  tabID: "tab_00000000-0000-4000-8000-000000000000",
  url: "http://localhost:5173/",
  element: { ref: "e42", selector: "#save", label: "button#save" },
  comment: "Rename this",
}

describe("browser element comments", () => {
  test("read from message metadata beside file comments and skip malformed entries", () => {
    const value = readPromptPresentation({
      displayText: "hi",
      comments: [browser, { ...browser, element: { label: "button" } }, { path: "src/app.ts", comment: "Keep" }],
    })
    expect(value?.comments).toEqual([browser, { path: "src/app.ts", comment: "Keep" }])
  })

  test("explain a selector that crosses into a shadow root", () => {
    expect(
      formatBrowserCommentNote({ ...browser, element: { ...browser.element, selector: "#card >>> div > button" } }),
    ).toContain('selector "#card >>> div > button" (">>>" enters a shadow root)')
    expect(formatBrowserCommentNote(browser)).not.toContain("shadow root")
  })

  test("leave out a selector that was too long to keep", () => {
    expect(formatBrowserCommentNote({ ...browser, element: { ...browser.element, selector: "" } })).toBe(
      'The user made the following comment regarding the "button#save" element in browser tab tab_00000000-0000-4000-8000-000000000000 at http://localhost:5173/ (browser ref @e42, usable as ref in any browser tool including browser.evaluate until the page navigates): Rename this',
    )
  })

  test("return to the composer without their element ref", () => {
    expect(commentContextItem(browser)).toEqual({
      ...browser,
      element: { selector: "#save", label: "button#save" },
      commentID: expect.any(String),
    })
  })
})
