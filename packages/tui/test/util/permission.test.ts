import { expect, test } from "bun:test"
import { permissionAlwaysLines, permissionPresentation } from "../../src/util/permission"

test("preserves permission roots and self-contained metadata", () => {
  expect(permissionPresentation({ action: "external_directory", resources: ["/*"] }).title).toBe(
    "Access external directory /",
  )
  expect(permissionPresentation({ action: "external_directory", resources: ["C:/*"] }).title).toBe(
    "Access external directory C:/",
  )
  expect(
    permissionPresentation({ action: "webfetch", resources: [], metadata: { url: "https://example.com" } }),
  ).toMatchObject({
    title: "WebFetch https://example.com",
    lines: ["URL: https://example.com"],
  })
  expect(permissionPresentation({ action: "websearch", resources: [], metadata: { query: "releases" } })).toMatchObject(
    {
      title: 'Web Search "releases"',
      lines: ["Query: releases"],
    },
  )
})

test("uses shuvcode in persistent permission guidance", () => {
  expect(permissionAlwaysLines({ action: "bash", save: ["*"] })).toEqual([
    "This will allow bash until shuvcode is restarted.",
  ])
  expect(permissionAlwaysLines({ action: "edit", save: ["src/**/*.ts"] })).toEqual([
    "This will allow the following patterns until shuvcode is restarted.",
    "- src/**/*.ts",
  ])
})
