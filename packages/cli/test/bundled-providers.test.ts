import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { verifyArtifact } from "../script/verify-artifact"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const markers = ["shuvcode.provider.claude", "claude-pro-max", "opencode.provider.google-antigravity", "google-ai-pro"]

async function artifact(content: string, filename: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shuvcode-bundled-providers-"))
  directories.push(directory)
  const file = path.join(directory, filename)
  await Bun.write(file, content)
  return file
}

for (const filename of ["shuvcode", "opencode.mjs"]) {
  test(`${filename} artifact requires both bundled subscription providers`, async () => {
    await verifyArtifact(await artifact(markers.join("\n"), filename))
    for (const missing of markers) {
      const file = await artifact(markers.filter((marker) => marker !== missing).join("\n"), filename)
      await expect(verifyArtifact(file)).rejects.toThrow("missing bundled subscription providers")
    }
  })
}

test("provider verification retains the forbidden-payload guard", async () => {
  await expect(verifyArtifact(await artifact(markers.join("\n") + "\n@napi-rs/canvas", "shuvcode"))).rejects.toThrow(
    "forbidden simulation payload",
  )
})
