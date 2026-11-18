import { expect, test } from "bun:test"
import { checkNpmPackageAvailability, isNpmVersionUploaded, waitForNpmPackages } from "../script/npm-availability"

const registry = "https://registry.example.test"
const tarballUrl = (name: string, version: string) => `${registry}/${name}/-/${name}-${version}.tgz`

type Published = {
  packument?: number
  listed?: boolean
  tag?: string
  metadata?: number
  metadataTarball?: string
  tarball?: number
}

// A registry whose views can disagree, as npm's CDN does while a publish propagates.
function fakeRegistry(packages: Record<string, Published>, version = "1.2.3-shuv.1") {
  const requests: Array<{ url: string; method: string; accept?: string; cache?: string }> = []
  const fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const headers = new Headers(init?.headers)
      requests.push({
        url,
        method: init?.method ?? "GET",
        accept: headers.get("Accept") ?? undefined,
        cache: headers.get("Cache-Control") ?? undefined,
      })
      const name = decodeURIComponent(url.slice(registry.length + 1).split("/")[0])
      const state = packages[name]
      if (!state) return new Response("not found", { status: 404 })
      if (url === tarballUrl(name, version)) return new Response(null, { status: state.tarball ?? 200 })
      if (url === `${registry}/${name}/${version}`)
        return Response.json(
          { name, version, dist: { tarball: state.metadataTarball ?? tarballUrl(name, version) } },
          { status: state.metadata ?? 200 },
        )
      if (url === `${registry}/${name}`)
        return Response.json(
          {
            name,
            "dist-tags": { latest: state.tag ?? version },
            versions: state.listed === false ? {} : { [version]: { dist: { tarball: tarballUrl(name, version) } } },
          },
          { status: state.packument ?? 200 },
        )
      return new Response("not found", { status: 404 })
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  return { fetch, requests }
}

test("reports a version ready once the packument, version document and tarball all serve it", async () => {
  const npm = fakeRegistry({ "shuvcode-linux-x64": {} })
  expect(
    await checkNpmPackageAvailability("shuvcode-linux-x64", "1.2.3-shuv.1", { registry, fetch: npm.fetch }),
  ).toEqual({
    name: "shuvcode-linux-x64",
    version: "1.2.3-shuv.1",
    ready: true,
    tarball: tarballUrl("shuvcode-linux-x64", "1.2.3-shuv.1"),
  })
  expect(npm.requests).toEqual([
    {
      url: `${registry}/shuvcode-linux-x64`,
      method: "GET",
      accept: "application/vnd.npm.install-v1+json",
      cache: "no-cache",
    },
    {
      url: `${registry}/shuvcode-linux-x64/1.2.3-shuv.1`,
      method: "GET",
      accept: "application/json",
      cache: "no-cache",
    },
    { url: tarballUrl("shuvcode-linux-x64", "1.2.3-shuv.1"), method: "HEAD", accept: undefined, cache: "no-cache" },
  ])
  expect(
    await checkNpmPackageAvailability("shuvcode-linux-x64", "1.2.3-shuv.1", {
      registry,
      fetch: npm.fetch,
      expectedTag: "latest",
    }),
  ).toMatchObject({ ready: true })
})

test.each([
  {
    name: "a version missing from the packument",
    state: { listed: false },
    reason: "packument does not list the version",
  },
  { name: "a packument error", state: { packument: 503 }, reason: "packument returned HTTP 503" },
  { name: "a dist-tag on another version", state: { tag: "1.2.2-shuv.1" }, reason: "dist-tag latest is 1.2.2-shuv.1" },
  { name: "missing version metadata", state: { metadata: 404 }, reason: "version metadata returned HTTP 404" },
  {
    name: "version metadata naming another tarball",
    state: { metadataTarball: `${registry}/elsewhere.tgz` },
    reason: `version metadata tarball ${registry}/elsewhere.tgz does not match ${tarballUrl("shuvcode", "1.2.3-shuv.1")}`,
  },
  {
    name: "published metadata whose tarball is not served yet",
    state: { tarball: 404 },
    reason: "tarball returned HTTP 404",
  },
])("reports $name as pending", async ({ state, reason }) => {
  const npm = fakeRegistry({ shuvcode: state })
  expect(
    await checkNpmPackageAvailability("shuvcode", "1.2.3-shuv.1", {
      registry,
      fetch: npm.fetch,
      expectedTag: "latest",
    }),
  ).toEqual({ name: "shuvcode", version: "1.2.3-shuv.1", ready: false, reason })
})

test("detects an uploaded version from its version document", async () => {
  const npm = fakeRegistry({
    shuvcode: {},
    "shuvcode-node": { metadata: 404 },
    "shuvcode-linux-x64": { metadata: 503 },
  })
  expect(await isNpmVersionUploaded("shuvcode", "1.2.3-shuv.1", { registry, fetch: npm.fetch })).toBe(true)
  expect(await isNpmVersionUploaded("shuvcode-node", "1.2.3-shuv.1", { registry, fetch: npm.fetch })).toBe(false)
  await expect(
    isNpmVersionUploaded("shuvcode-linux-x64", "1.2.3-shuv.1", { registry, fetch: npm.fetch }),
  ).rejects.toThrow("npm registry returned HTTP 503 for shuvcode-linux-x64@1.2.3-shuv.1")
  expect(npm.requests.map((request) => [request.url, request.accept, request.cache])).toEqual([
    [`${registry}/shuvcode/1.2.3-shuv.1`, "application/json", "no-cache"],
    [`${registry}/shuvcode-node/1.2.3-shuv.1`, "application/json", "no-cache"],
    [`${registry}/shuvcode-linux-x64/1.2.3-shuv.1`, "application/json", "no-cache"],
  ])
})

test("waits through transient registry lag until every package is ready", async () => {
  const packages: Record<string, Published> = {
    "shuvcode-linux-x64": { metadata: 404 },
    "shuvcode-darwin-arm64": { tarball: 404 },
    "shuvcode-node-linux-x64": {},
  }
  const npm = fakeRegistry(packages)
  const clock = { now: 0, sleeps: [] as number[] }
  const pending: string[][] = []
  await waitForNpmPackages(Object.keys(packages), "1.2.3-shuv.1", {
    registry,
    fetch: npm.fetch,
    now: () => clock.now,
    intervalMs: 1_000,
    timeoutMs: 10_000,
    sleep: async (ms) => {
      clock.sleeps.push(ms)
      clock.now += ms
      if (clock.sleeps.length === 1) packages["shuvcode-linux-x64"] = {}
      if (clock.sleeps.length === 2) packages["shuvcode-darwin-arm64"] = {}
    },
    onPending: (items) => pending.push(items.map((item) => `${item.name}: ${item.reason}`)),
  })
  expect(clock.sleeps).toEqual([1_000, 1_000])
  expect(pending).toEqual([
    ["shuvcode-linux-x64: version metadata returned HTTP 404", "shuvcode-darwin-arm64: tarball returned HTTP 404"],
    ["shuvcode-darwin-arm64: tarball returned HTTP 404"],
  ])
})

test("names every lagging package and its reason when the deadline passes", async () => {
  const npm = fakeRegistry({
    shuvcode: { tag: "1.2.2-shuv.1" },
    "shuvcode-node": { tarball: 404 },
    "shuvcode-linux-x64": {},
  })
  const clock = { now: 0 }
  const error = await waitForNpmPackages(["shuvcode", "shuvcode-node", "shuvcode-linux-x64"], "1.2.3-shuv.1", {
    registry,
    fetch: npm.fetch,
    expectedTag: "latest",
    now: () => clock.now,
    intervalMs: 1_000,
    timeoutMs: 3_000,
    sleep: async (ms) => {
      clock.now += ms
    },
    onPending: () => {},
  }).catch((cause: unknown) => cause)
  expect(error).toBeInstanceOf(Error)
  expect(error instanceof Error && error.message).toBe(
    "Timed out after 3000ms waiting for npm availability: shuvcode@1.2.3-shuv.1 (dist-tag latest is 1.2.2-shuv.1), shuvcode-node@1.2.3-shuv.1 (tarball returned HTTP 404)",
  )
  expect(clock.now).toBe(3_000)
})
