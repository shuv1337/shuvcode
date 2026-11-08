import fs from "node:fs/promises"
import net from "node:net"
import path from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"
import { startServer } from "./fixture/server"

const auth = { authorization: `Basic ${btoa("opencode:secret")}` }
const blocked = "Cross-site requests to the API are not allowed"

it.live("rejects API navigations and calls from other sites while other clients pass", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "page.html"), "<p>hi</p>"))
    const server = yield* startServer(path.join(tmp.path, "config"))
    const read = new URL("/api/fs/read/page.html", server.base)
    read.searchParams.set("location[directory]", tmp.path)
    const status = (url: URL | string, headers: Record<string, string>, method = "GET") =>
      Effect.promise(async () => {
        const response = await fetch(new URL(url, server.base), {
          method,
          headers: { ...server.headers, ...headers },
        })
        return response.status
      })
    const navigate = (site: string) => ({
      "sec-fetch-site": site,
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
    })

    // Native clients, same-origin pages and typed-in URLs.
    expect(yield* status(read, {})).toBe(200)
    expect(yield* status(read, navigate("same-origin"))).toBe(200)
    expect(yield* status(read, navigate("none"))).toBe(200)
    expect(yield* status(read, { "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" })).toBe(200)

    // Another site opening an API URL as a page.
    expect(yield* status(read, navigate("cross-site"))).toBe(403)
    expect(yield* status(read, navigate("same-site"))).toBe(403)
    expect(yield* status("/api/path", navigate("cross-site"))).toBe(403)
    expect(yield* status("/api/path", navigate("cross-site"), "POST")).toBe(403)

    // Calls from other sites need an allowed origin; media elements send none.
    const cors = (origin: string) => ({ "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors", origin })
    expect(yield* status(read, cors("https://app.opencode.ai"))).toBe(200)
    expect(yield* status(read, cors("oc://renderer"))).toBe(200)
    expect(yield* status(read, cors("http://localhost:3000"))).toBe(200)
    expect(yield* status(read, cors("https://example.com"))).toBe(403)
    expect(yield* status(read, cors("http://localhost.example.com:4919"))).toBe(403)
    expect(yield* status(read, cors("https://app.opencode.ai.example.com"))).toBe(403)
    expect(yield* status("/api/path", cors("null"), "POST")).toBe(403)
    expect(
      yield* status(
        "/api/path",
        { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", origin: "https://example.com" },
        "POST",
      ),
    ).toBe(403)
    expect(
      yield* status(read, { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "video" }),
    ).toBe(200)

    // Pairing links and artifact pages are opened from elsewhere on purpose.
    expect(yield* status("/auth/connect/expired", { ...navigate("cross-site"), accept: "text/html" })).toBe(401)
    const artifact = new URL("/api/experimental/artifacts/art_missing/view/", server.base)
    artifact.searchParams.set("location[directory]", tmp.path)
    const opened = yield* Effect.promise(() =>
      fetch(artifact, { headers: { ...server.headers, ...navigate("cross-site") } }).then((response) =>
        response.json(),
      ),
    )
    expect(opened.message).not.toBe(blocked)
  }),
)

// The router folds case, decodes percent escapes once and collapses duplicate slashes, so each of these reaches the API.
const readPrefixes = ["/api", "/API", "/Api", "/%61pi", "/%41PI", "//api"]
const writes = ["/api/session", "/API/session", "/Api/Session", "/%61pi/session", "/api/%53ession"]
// A second decoding and a malformed escape reach no route at all.
const unrouted = ["/%2561pi/fs/read/secret.txt", "/api/fs/read/%ZZ"]
const crossSiteNavigation = {
  "sec-fetch-site": "cross-site",
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
}
const crossSiteCall = (origin: string) => ({
  "sec-fetch-site": "cross-site",
  "sec-fetch-mode": "cors",
  origin,
  "content-type": "application/json",
})

const servers = {
  ServerProcess: Effect.fnUntraced(function* (directory: string) {
    const server = yield* startServer(path.join(directory, "config"))
    return { origin: server.base, send: (url: string, init: RequestInit) => fetch(server.base + url, init) }
  }),
  ServerFetch: Effect.fnUntraced(function* (directory: string) {
    const handler = yield* ServerFetch.make({
      app: { version: "test-version" },
      password: "secret",
      database: { path: ":memory:" },
      config: { directory: path.join(directory, "config") },
      fs: { filewatcher: false },
      models: { fetch: false },
    })
    return {
      origin: "http://opencode.local",
      send: (url: string, init: RequestInit) => handler(new Request(`http://opencode.local${url}`, init)),
    }
  }),
}

const client = Effect.fnUntraced(function* (start: (typeof servers)[keyof typeof servers]) {
  const tmp = yield* tmpdirScoped()
  yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "secret.txt"), "TOP-SECRET"))
  const server = yield* start(tmp.path)
  const call = (url: string, headers: Record<string, string>, init: RequestInit = {}) =>
    Effect.promise(async () => {
      const response = await server.send(url, { ...init, headers: { ...auth, ...headers } })
      return { url, status: response.status, leaked: (await response.text()).includes("TOP-SECRET") }
    })
  return {
    origin: server.origin,
    query: `?${new URLSearchParams({ "location[directory]": tmp.path })}`,
    send: server.send,
    call,
    create: (url: string, headers: Record<string, string>, title = url) =>
      call(url, headers, { method: "POST", body: JSON.stringify({ title }) }),
    sessions: Effect.promise(async () => {
      const body: { data: Array<{ id: string; title: string }> } = await (
        await server.send("/api/session", { headers: auth })
      ).json()
      return body.data
        .map((session) => ({ id: session.id, title: session.title }))
        .toSorted((a, b) => (a.title < b.title ? -1 : 1))
    }),
  }
})

for (const [name, start] of Object.entries(servers)) {
  it.live(`${name} rejects cross-site reads under every spelling the router sends to the API`, () =>
    Effect.gen(function* () {
      const api = yield* client(start)
      const reads = readPrefixes.map((prefix) => `${prefix}/fs/read/secret.txt${api.query}`)
      expect(yield* Effect.forEach(reads, (url) => api.call(url, crossSiteNavigation))).toEqual(
        reads.map((url) => ({ url, status: 403, leaked: false })),
      )
      const missing = unrouted.map((url) => url + api.query)
      expect(yield* Effect.forEach(missing, (url) => api.call(url, crossSiteNavigation))).toEqual(
        missing.map((url) => ({ url, status: 404, leaked: false })),
      )
    }),
  )

  it.live(`${name} rejects cross-site writes under every spelling and leaves the session list unchanged`, () =>
    Effect.gen(function* () {
      const api = yield* client(start)
      yield* api.create("/api/session", { "content-type": "application/json" }, "existing")
      const before = yield* api.sessions
      const existing = readPrefixes.slice(0, 4).map((prefix) => `${prefix}/session/${before[0].id}`)
      const crossSite = crossSiteCall("https://example.com")
      const responses = [
        ...(yield* Effect.forEach(writes, (url) => api.create(url, crossSite))),
        ...(yield* Effect.forEach(existing, (url) =>
          api.call(url, crossSite, { method: "PATCH", body: JSON.stringify({ title: "changed" }) }),
        )),
        ...(yield* Effect.forEach(existing, (url) => api.call(url, crossSite, { method: "DELETE" }))),
      ]
      expect({ responses, sessions: yield* api.sessions }).toEqual({
        responses: [...writes, ...existing, ...existing].map((url) => ({ url, status: 403, leaked: false })),
        sessions: before,
      })
    }),
  )

  it.live(`${name} keeps normal /api reads and writes from native clients and the same origin`, () =>
    Effect.gen(function* () {
      const api = yield* client(start)
      const json = { "content-type": "application/json" }
      const sameOrigin = { "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", origin: api.origin, ...json }
      const read = `/api/fs/read/secret.txt${api.query}`
      expect(yield* api.call(read, {})).toMatchObject({ status: 200, leaked: true })
      expect(yield* api.call(read, sameOrigin)).toMatchObject({ status: 200, leaked: true })
      expect(yield* api.create("/api/session", json, "native")).toMatchObject({ status: 200 })
      expect(yield* api.create("/api/session", sameOrigin, "same-origin")).toMatchObject({ status: 200 })
      const created = yield* api.sessions
      expect(created.map((session) => session.title)).toEqual(["native", "same-origin"])
      const update = { method: "PATCH", body: JSON.stringify({ title: "renamed" }) }
      expect(yield* api.call(`/api/session/${created[0].id}`, sameOrigin, update)).toMatchObject({ status: 204 })
      expect(yield* api.call(`/api/session/${created[1].id}`, {}, { method: "DELETE" })).toMatchObject({ status: 204 })
      expect(yield* api.sessions).toEqual([{ id: created[0].id, title: "renamed" }])
    }),
  )

  it.live(`${name} keeps native, same-origin and allowed-origin calls under those spellings`, () =>
    Effect.gen(function* () {
      const api = yield* client(start)
      expect(yield* api.call(`/API/fs/read/secret.txt${api.query}`, {})).toMatchObject({ status: 200, leaked: true })
      expect(
        yield* api.call(`/Api/fs/read/secret.txt${api.query}`, {
          ...crossSiteNavigation,
          "sec-fetch-site": "same-origin",
        }),
      ).toMatchObject({ status: 200, leaked: true })
      expect(yield* api.create("/API/session", { "content-type": "application/json" })).toMatchObject({ status: 200 })
      expect(yield* api.create("/%61pi/Session", crossSiteCall("https://app.opencode.ai"))).toMatchObject({
        status: 200,
      })
      expect((yield* api.sessions).map((session) => session.title)).toEqual(["/%61pi/Session", "/API/session"])

      const artifact = yield* Effect.promise(() =>
        api
          .send(`/API/experimental/artifacts/art_missing/VIEW/${api.query}`, {
            headers: { ...auth, ...crossSiteNavigation },
          })
          .then((response) => response.json()),
      )
      expect(artifact.message).not.toBe(blocked)
    }),
  )
}

it.live("ServerProcess classifies raw request targets the way the router reads them", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "secret.txt"), "TOP-SECRET"))
    const address = new URL((yield* startServer(path.join(tmp.path, "config"))).base)
    const query = `?${new URLSearchParams({ "location[directory]": tmp.path })}`
    const head = Object.entries({ host: address.host, ...auth, ...crossSiteNavigation, connection: "close" })
      .map(([key, value]) => `${key}: ${value}\r\n`)
      .join("")
    const raw = (target: string) =>
      Effect.promise(
        () =>
          new Promise<string>((resolve, reject) => {
            const chunks: string[] = []
            const socket = net.connect(Number(address.port), address.hostname)
            socket.setEncoding("utf8")
            socket.on("connect", () => socket.end(`GET ${target} HTTP/1.1\r\n${head}\r\n`))
            socket.on("data", (chunk: string) => chunks.push(chunk))
            socket.on("end", () => resolve(chunks.join("")))
            socket.on("error", reject)
          }),
      ).pipe(
        Effect.map((response) => ({ target, status: response.split(" ")[1], leaked: response.includes("TOP-SECRET") })),
      )

    // An absolute-form target is routed by its path, so it is guarded by it.
    expect(yield* raw(`http://example.com/API/fs/read/secret.txt${query}`)).toMatchObject({
      status: "403",
      leaked: false,
    })
    // The router does not resolve dot segments, so this target reaches no route rather than the API.
    expect(yield* raw(`/auth/../api/fs/read/secret.txt${query}`)).toMatchObject({ status: "404", leaked: false })
  }),
)
