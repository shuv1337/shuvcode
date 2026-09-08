import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

for (const runtime of ["installed", "source", "candidate"]) {
  const result = JSON.parse(await readFile(new URL(`${runtime}-execution.json`, import.meta.url), "utf8"))
  assert.equal(result.runtime, runtime)
  assert.equal(result.result, "passed")
  assert.equal(result.checks.length, 22)
  assert.equal(result.modelRequests.length, 2)
  assert.equal(result.contextLimit, 200000)
  assert.equal(result.providerPackage, "aisdk:@ai-sdk/openai-compatible")
  for (const check of result.checks) assert.deepEqual(check.observed, check.expected, `${runtime}: ${check.name}`)
}
const native = JSON.parse(await readFile(new URL("candidate-native-tui.json", import.meta.url), "utf8"))
assert.equal(native.result, "passed")
assert.equal(native.checks.length, 30)
assert.equal(native.modelRequests.length, 2)
for (const check of native.checks) assert.deepEqual(check.observed, check.expected, `native TUI: ${check.name}`)
const red = JSON.parse(await readFile(new URL("installed-legacy-package.json", import.meta.url), "utf8"))
assert.equal(red.result, "failed")
assert.equal(red.providerPackage, "@ai-sdk/openai-compatible")
assert.equal(red.checks[1].name, "first_admitted")
assert.equal(red.checks[1].observed, 200)
assert.equal(red.modelRequests.length, 0)
assert.equal(red.failure.message, "Timed out: first loopback model request")
console.log("Verified fixture failure, 22 execution assertions on three runtimes, and 30 native TUI assertions.")
