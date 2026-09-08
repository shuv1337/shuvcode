import { expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

// Exercise real HTTP + SQLite across SIGKILL without a provider.
// Set SHUV_RECEIPT_BINARY to run the same checks against a compiled candidate.
test("form and permission HTTP receipts survive process death and fence unavailable callbacks", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "shuvcode-receipts-"))
  const children: Bun.Subprocess[] = []
  await mkdir(path.join(root, "config"))
  await mkdir(path.join(root, "other"))
  await Bun.write(
    path.join(root, "config/opencode.json"),
    JSON.stringify({
      autoupdate: false,
      permissions: [{ action: "shell", resource: "*", effect: "ask" }],
    }),
  )
  try {
    const first = await start(root)
    children.push(first.child)
    await first.request("GET", "/api/model/default", undefined, root)
    const created = await first.request("POST", "/api/session", { location: { directory: root } })
    expect(created.status).toBe(200)
    const sessionID = created.body.data.id as string
    const other = await first.request("POST", "/api/session", { location: { directory: root } })
    const otherID = other.body.data.id as string
    const route = `/api/session/${sessionID}`
    for (const id of ["frm_answered", "frm_pending"]) {
      expect(
        (
          await first.request("POST", route + "/form", {
            id,
            title: "Synthetic request",
            fields: [{ key: "answer", type: "string" }],
          })
        ).status,
      ).toBe(200)
    }
    for (const id of ["per_answered", "per_pending"]) {
      const created = await first.request("POST", route + "/permission", {
        id,
        action: "shell",
        resources: ["pwd"],
      })
      expect(created.status).toBe(200)
      expect(created.body.data.effect).toBe("ask")
    }
    for (const responseID of ["", "x".repeat(201)]) {
      expect(
        (await first.request("POST", route + "/form/frm_answered/reply", { answer: { answer: "invalid" }, responseID }))
          .status,
      ).toBe(400)
      expect(
        (await first.request("POST", route + "/permission/per_answered/reply", { reply: "once", responseID })).status,
      ).toBe(400)
    }
    const answer = { answer: { answer: "continue" }, responseID: "synthetic-form" }
    const approval = { reply: "once", responseID: "synthetic-permission" }
    expect((await first.request("POST", route + "/form/frm_answered/reply", answer)).status).toBe(204)
    expect((await first.request("POST", route + "/permission/per_answered/reply", approval)).status).toBe(204)
    first.child.kill("SIGKILL")
    await first.child.exited

    const second = await start(root)
    children.push(second.child)
    for (const [kind, id, payload, state] of [
      ["form", "frm_answered", answer, { status: "answered", answer: { answer: "continue" } }],
      ["permission", "per_answered", approval, { status: "answered", reply: "once" }],
    ] as const) {
      const receipt = await second.request("GET", `${route}/${kind}/${id}/receipt`)
      expect(receipt.status).toBe(200)
      expect(receipt.body.data).toMatchObject({ state, available: false, responseID: payload.responseID })
      expect((await second.request("POST", `${route}/${kind}/${id}/reply`, payload)).status).toBe(204)
      expect((await second.request("GET", `/api/session/${otherID}/${kind}/${id}/receipt`)).status).toBe(404)
      expect((await second.request("POST", `/api/session/${otherID}/${kind}/${id}/reply`, payload)).status).toBe(404)
    }
    expect(
      (
        await second.request("POST", route + "/form/frm_answered/reply", {
          ...answer,
          answer: { answer: "changed" },
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await second.request("POST", route + "/permission/per_answered/reply", {
          ...approval,
          reply: "reject",
        })
      ).status,
    ).toBe(404)
    for (const [kind, id, payload] of [
      ["form", "frm_pending", answer],
      ["permission", "per_pending", approval],
    ] as const) {
      const receipt = await second.request("GET", `${route}/${kind}/${id}/receipt`)
      expect(receipt.body.data).toMatchObject({ state: { status: "pending" }, available: false })
      expect((await second.request("POST", `${route}/${kind}/${id}/reply`, payload)).status).toBe(404)
      expect((await second.request("GET", `${route}/${kind}`)).body.data).toEqual([])
    }
    const global = await second.request(
      "POST",
      "/api/session/global/form",
      {
        id: "frm_global",
        title: "Global",
        fields: [{ key: "answer", type: "string" }],
      },
      root,
    )
    expect(global.status).toBe(200)
    expect(
      (await second.request("GET", "/api/session/global/form/frm_global/receipt", undefined, path.join(root, "other")))
        .status,
    ).toBe(404)
    expect(
      (await second.request("GET", "/api/session/global/form/frm_global/receipt", undefined, root)).body.data.available,
    ).toBe(true)
  } finally {
    for (const child of children) {
      if (child.exitCode === null) child.kill("SIGKILL")
      await child.exited
    }
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)

async function start(root: string) {
  const child = Bun.spawn(
    [
      ...(process.platform === "darwin"
        ? [
            "/usr/bin/sandbox-exec",
            "-p",
            '(version 1)(allow default)(deny network*)(allow network-inbound (local ip "localhost:*"))(allow network-outbound (remote ip "localhost:*"))',
          ]
        : []),
      ...(process.env.SHUV_RECEIPT_BINARY
        ? [process.env.SHUV_RECEIPT_BINARY]
        : [process.execPath, path.join(import.meta.dir, "../src/index.ts")]),
      "serve",
      "--stdio",
      "--hostname",
      "127.0.0.1",
      "--port",
      "0",
    ],
    {
      cwd: path.join(import.meta.dir, ".."),
      env: {
        HOME: root,
        PATH: process.env.PATH,
        OPENCODE_TEST_HOME: root,
        OPENCODE_CONFIG_DIR: path.join(root, "config"),
        OPENCODE_DB: path.join(root, "requests.db"),
        OPENCODE_PASSWORD: "synthetic-receipt-password",
        OPENCODE_CONFIG_PROJECT_DISABLE: "true",
        OPENCODE_DISABLE_FFF: "true",
        OPENCODE_DISABLE_FILEWATCHER: "true",
        OPENCODE_DISABLE_MODELS_FETCH: "true",
        OPENCODE_DISABLE_AUTOUPDATE: "true",
        XDG_CONFIG_HOME: path.join(root, "xdg-config"),
        XDG_DATA_HOME: path.join(root, "data"),
        XDG_CACHE_HOME: path.join(root, "cache"),
        XDG_STATE_HOME: path.join(root, "state"),
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const diagnostics = new Response(child.stderr).text()
  const reader = child.stdout.getReader()
  const decoder = new TextDecoder()
  const readURL = async () => {
    let output = ""
    while (!output.includes("\n")) {
      const next = await reader.read()
      if (next.done) throw new Error("CLI exited before listening")
      output += decoder.decode(next.value, { stream: true })
    }
    return JSON.parse(output.slice(0, output.indexOf("\n"))).url as string
  }
  try {
    const base = await Promise.race([
      readURL(),
      Bun.sleep(20_000).then(() => {
        throw new Error("startup timeout")
      }),
    ])
    const request = async (method: string, route: string, body?: unknown, directory?: string) => {
      const response = await fetch(base + route, {
        method,
        headers: {
          authorization: "Basic " + btoa("opencode:synthetic-receipt-password"),
          "content-type": "application/json",
          ...(directory ? { "x-opencode-directory": encodeURIComponent(directory) } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10_000),
      })
      const text = await response.text()
      return { status: response.status, body: text ? JSON.parse(text) : undefined }
    }
    return { child, request }
  } catch (error) {
    child.kill("SIGKILL")
    await child.exited
    throw new Error(await diagnostics, { cause: error })
  } finally {
    reader.releaseLock()
  }
}
