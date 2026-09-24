import { describe, expect, test } from "bun:test"

import {
  blockquote,
  filterParagraphs,
  paragraphs,
  quoteTrigger,
} from "../../src/feature-plugins/prompt/quick-quote-text"

describe("paragraphs", () => {
  test("preserves multiline paragraphs and individual list items", () => {
    expect(paragraphs("First line\nsecond line.\n\n- One\n- Two\n\nLast.")).toEqual([
      "First line\nsecond line.",
      "- One",
      "- Two",
      "Last.",
    ])
  })

  test("keeps fenced code and tables intact, including internal blank lines", () => {
    const code = "```ts\nconst x = 1\n\nconsole.log(x)\n```"
    const table = "| a | b |\n| - | - |\n| 1 | 2 |"
    expect(paragraphs(`Intro.\n\n${code}\n\n${table}`)).toEqual(["Intro.", code, table])
    expect(blockquote(code)).toBe("> ```ts\n> const x = 1\n>\n> console.log(x)\n> ```")
  })

  test("normalizes CRLF and ignores separators and link definitions", () => {
    expect(paragraphs("Hello.\r\n\r\n---\r\n\r\n[ref]: https://example.com\r\n\r\nBye.")).toEqual(["Hello.", "Bye."])
  })
})

test("triggers at the start of any logical line", () => {
  expect(quoteTrigger(">")?.query).toBe("")
  expect(quoteTrigger("My reply 🙂\n\n>Saturday")?.query).toBe("Saturday")
  expect(quoteTrigger("My reply 🙂\n\n>Saturday")?.row).toBe(2)
  expect(quoteTrigger("a >Saturday")).toBeUndefined()
  expect(quoteTrigger("\\>Saturday")).toBeUndefined()
  expect(quoteTrigger(">>Saturday")).toBeUndefined()
})

test("suppresses completion inside fenced code, including longer fences", () => {
  expect(quoteTrigger("```sh\n>out")).toBeUndefined()
  expect(quoteTrigger("~~~~\n~~~\n>out")).toBeUndefined()
  expect(quoteTrigger("```sh\n>out\n```\n>Saturday")?.query).toBe("Saturday")
})

test("filters all search words case-insensitively, retaining message order", () => {
  const items = ["Call her on Saturday.", "Send her a message.", "Saturday: call again."]
  expect(filterParagraphs(items, "SAT call")).toEqual([items[0], items[2]])
  expect(filterParagraphs(items, "")).toEqual(items)
  expect(filterParagraphs(items, "Sunday")).toEqual([])
})
