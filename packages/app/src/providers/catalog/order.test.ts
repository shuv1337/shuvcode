import { expect, test } from "bun:test"
import { connectPopular, omitHiddenProviderCatalog, popularProviders, withoutHiddenProviders } from "./order"

test("keeps Anthropic visible and drops Claude Agent from provider menus", () => {
  expect(popularProviders).toContain("anthropic")
  expect(connectPopular).toContain("anthropic")
  expect(popularProviders).not.toContain("claude-agent")
  expect(connectPopular).not.toContain("claude-agent")

  expect(withoutHiddenProviders([{ id: "claude-agent" }, { id: "anthropic" }]).map((item) => item.id)).toEqual([
    "anthropic",
  ])

  const catalog = omitHiddenProviderCatalog({
    all: new Map<string, { name: string }>([
      ["claude-agent", { name: "Claude Agent" }],
      ["anthropic", { name: "Anthropic" }],
    ]),
    connected: ["claude-agent", "anthropic"],
    default: { "claude-agent": "sonnet", anthropic: "claude-sonnet" },
  })

  expect([...catalog.all.keys()]).toEqual(["anthropic"])
  expect(catalog.connected).toEqual(["anthropic"])
  expect(catalog.default).toEqual({ anthropic: "claude-sonnet" })
})
