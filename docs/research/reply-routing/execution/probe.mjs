import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import path from "node:path"
import timers from "node:timers/promises"
import { fileURLToPath } from "node:url"

// Agreed seams: V2 HTTP prompt/inbox/active/wait/context and the external model transport.
// No core services, coordinator state, or database projections are mocked or queried.
const directory = path.dirname(fileURLToPath(import.meta.url))
const repository = path.resolve(directory, "../../../..")
const source = process.argv.includes("--source")
const tuiMode = process.argv.includes("--tui")
if (tuiMode && typeof Bun === "undefined") throw new Error("The native TUI probe requires Bun.Terminal")
const runtimeKind = source ? "source" : process.env.SHUV_EXECUTION_BINARY ? "candidate" : "installed"
const legacy = process.argv.includes("--legacy-package")
const smallContext = process.argv.includes("--small-context")
const binary =
  process.env.SHUV_EXECUTION_BINARY ?? "/Users/shuv/.bun/install/global/node_modules/shuvcode-darwin-arm64/bin/shuvcode"
const bun = process.env.SHUV_EXECUTION_BUN ?? "/Users/shuv/.bun/bin/bun"
const runtime = await mkdtemp(path.join(directory, ".runtime-"))
const password = randomBytes(32).toString("base64url")
const modelRequests = []
const heldResponses = []
let tui
let terminal
let terminalOutput = ""
let child
let shutdown
let base
let logs = ""
assert.equal(process.platform, "darwin", "Probe requires the macOS loopback-only sandbox")

const complete = (response, ordinal) => {
  response.writeHead(200, { "Content-Type": "text/event-stream" })
  response.write(
    `data: ${JSON.stringify({ id: `synthetic-${ordinal}`, object: "chat.completion.chunk", created: 1, model: "synthetic", choices: [{ index: 0, delta: { role: "assistant", content: `Synthetic reply ${ordinal}.` }, finish_reason: null }] })}\n\n`,
  )
  response.write(
    `data: ${JSON.stringify({ id: `synthetic-${ordinal}`, object: "chat.completion.chunk", created: 1, model: "synthetic", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`,
  )
  response.end("data: [DONE]\n\n")
}
const model = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const input = JSON.parse(Buffer.concat(chunks).toString())
  modelRequests.push({
    ordinal: modelRequests.length + 1,
    path: request.url,
    userMessageCount: input.messages?.filter((message) => message.role === "user").length,
  })
  if (modelRequests.length === 1) {
    heldResponses.push(response)
    return
  }
  complete(response, modelRequests.length)
})
await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve))
const env = {
  HOME: runtime,
  PATH: "/Users/shuv/.bun/bin:/opt/homebrew/bin:/usr/bin:/bin",
  OPENCODE_TEST_HOME: runtime,
  XDG_CONFIG_HOME: path.join(runtime, "config"),
  XDG_DATA_HOME: path.join(runtime, "data"),
  XDG_CACHE_HOME: path.join(runtime, "cache"),
  XDG_STATE_HOME: path.join(runtime, "state"),
  TMPDIR: path.join(runtime, "tmp"),
  OPENCODE_CONFIG_DIR: path.join(runtime, "config"),
  OPENCODE_DB: path.join(runtime, "probe.db"),
  OPENCODE_PASSWORD: password,
  OPENCODE_DISABLE_AUTOUPDATE: "1",
  OPENCODE_DISABLE_MODELS_FETCH: "1",
  OPENCODE_DISABLE_PROJECT_CONFIG: "1",
  OPENCODE_DISABLE_FILEWATCHER: "1",
  OPENCODE_DISABLE_FFF: "1",
  SHUV_EXECUTION_API_KEY: "synthetic-noncredential",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
}
await Promise.all(
  ["config", "data", "cache", "state", "tmp", "project"].map((name) =>
    mkdir(path.join(runtime, name), { mode: 0o700 }),
  ),
)
// Bound native project discovery to the disposable fixture instead of its repository ancestors.
assert.equal(spawnSync("/usr/bin/git", ["init", "--quiet"], { cwd: runtime, env }).status, 0)
const providerPackage = legacy ? "@ai-sdk/openai-compatible" : "aisdk:@ai-sdk/openai-compatible"
const contextLimit = smallContext ? 8192 : 200000
await writeFile(
  path.join(runtime, "config", "opencode.json"),
  JSON.stringify({
    autoupdate: false,
    permissions: [
      { action: "*", resource: "*", effect: "deny" },
      ...(tuiMode ? [{ action: "shell", resource: "*", effect: "ask" }] : []),
    ],
    providers: {
      "execution-probe": {
        package: providerPackage,
        env: ["SHUV_EXECUTION_API_KEY"],
        settings: { baseURL: `http://127.0.0.1:${model.address().port}/v1`, name: "execution-probe" },
        models: {
          synthetic: {
            name: "Synthetic fixture",
            limit: { context: contextLimit, output: 100 },
            capabilities: { tools: false, input: ["text"], output: ["text"] },
          },
        },
      },
    },
  }),
  { mode: 0o600 },
)
const profile =
  '(version 1)(allow default)(deny network*)(allow network-inbound (local ip "localhost:*"))(allow network-outbound (remote ip "localhost:*"))'
const launch = source
  ? [bun, "run", "--conditions=browser", path.join(repository, "packages/cli/src/index.ts")]
  : [binary]
// Source CLI loading needs its Bun JSX preload; session location remains the isolated fixture.
const childDirectory = source ? path.join(repository, "packages/cli") : runtime
const sandbox = ["-p", profile, ...launch]
const evidence = {
  observedAt: new Date().toISOString(),
  runtime: runtimeKind,
  sourceHead: spawnSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).stdout.trim(),
  binarySha256: source
    ? undefined
    : createHash("sha256")
        .update(await readFile(binary))
        .digest("hex"),
  providerPackage,
  contextLimit,
  isolation: {
    freshHome: true,
    freshDatabase: true,
    nestedDisposableGitRoot: true,
    inheritedCredentials: false,
    nonLoopbackNetworkDenied: true,
  },
  checks: [],
}
const check = (name, observed, expected) => {
  evidence.checks.push({ name, observed, expected })
  assert.deepEqual(observed, expected, name)
}
async function start() {
  child = spawn(
    "/usr/bin/sandbox-exec",
    [...sandbox, "serve", "--stdio", "--hostname", "127.0.0.1", "--port", "0", "--print-logs"],
    { cwd: childDirectory, env, stdio: ["pipe", "pipe", "pipe"] },
  )
  shutdown = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })))
  child.stderr.on("data", (chunk) => {
    logs += chunk.toString()
  })
  base = await new Promise((resolve, reject) => {
    let stdout = ""
    const timeout = setTimeout(() => reject(new Error("Disposable server startup timeout")), 30000)
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
      const lines = stdout.split("\n")
      stdout = lines.pop() ?? ""
      for (const line of lines) {
        if (!line.startsWith("{")) continue
        const parsed = JSON.parse(line)
        if (typeof parsed.url !== "string") continue
        const url = new URL(parsed.url)
        assert.equal(url.hostname, "127.0.0.1")
        clearTimeout(timeout)
        resolve(url.origin)
      }
    })
    child.once("exit", (code) => {
      clearTimeout(timeout)
      reject(new Error(`Disposable server exited during startup (${code})`))
    })
  })
}
async function stop(signal = "SIGTERM") {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill(signal)
  const timeout = setTimeout(() => child.kill("SIGKILL"), 5000)
  await shutdown
  clearTimeout(timeout)
}
async function request(method, route, body) {
  const response = await fetch(base + route, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  })
  const text = await response.text()
  return { status: response.status, data: text ? JSON.parse(text) : undefined }
}
async function until(predicate, label) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await predicate()) return
    await timers.setTimeout(50)
  }
  throw new Error(`Timed out: ${label}`)
}

const sessionID = "ses_execution_regression"
const endpoint = `/api/session/${sessionID}`
const first = { id: "msg_execution_first", text: "First synthetic input", delivery: "queue" }
const second = { id: "msg_execution_second", text: "Second synthetic input", delivery: "queue" }
try {
  await start()
  evidence.version = spawnSync("/usr/bin/sandbox-exec", [...sandbox, "--version"], {
    cwd: childDirectory,
    env,
    encoding: "utf8",
    timeout: 30000,
  }).stdout.trim()
  check(
    "create_session",
    (
      await request("POST", "/api/session", {
        id: sessionID,
        title: "Synthetic execution regression",
        model: { providerID: "execution-probe", id: "synthetic" },
        location: { directory: path.join(runtime, "project") },
      })
    ).status,
    200,
  )
  if (tuiMode) {
    terminal = new Bun.Terminal({
      cols: 120,
      rows: 40,
      data(term, data) {
        const output = new TextDecoder().decode(data)
        terminalOutput += output
        if (output.includes("\x1b[6n")) term.write("\x1b[1;1R")
        if (output.includes("\x1b[c")) term.write("\x1b[?1;2c")
      },
    })
    tui = Bun.spawn(
      [
        "/usr/bin/sandbox-exec",
        ...sandbox,
        "--server",
        base,
        "--session",
        sessionID,
        "--prompt",
        first.text,
        path.join(runtime, "project"),
      ],
      {
        cwd: childDirectory,
        env: { ...env, TERM: "xterm-256color", COLORTERM: "truecolor" },
        terminal,
      },
    )
    await until(() => modelRequests.length > 0, "native TUI prompt reaches loopback model")
    const messages = (await request("GET", `${endpoint}/context`)).data.data
    const admitted = messages.find((message) => message.type === "user")
    check("native_tui_prompt_admitted", admitted?.text, first.text)
    first.id = admitted.id
  } else {
    const firstReceipt = await request("POST", `${endpoint}/prompt`, first)
    check("first_admitted", firstReceipt.status, 200)
    await until(() => modelRequests.length > 0, "first loopback model request")
  }
  check("wake_reaches_model", modelRequests.length, 1)
  check(
    "busy_while_model_held",
    Object.hasOwn((await request("GET", "/api/session/active")).data.data, sessionID),
    true,
  )
  const secondReceipt = await request("POST", `${endpoint}/prompt`, second)
  check("second_admitted_while_busy", secondReceipt.status, 200)
  check(
    "second_remains_queued",
    (await request("GET", `${endpoint}/inbox`)).data.data.map((item) => item.id),
    [second.id],
  )
  check("no_parallel_model_call", modelRequests.length, 1)
  check(
    "pending_replay_same_receipt",
    await request("POST", `${endpoint}/prompt`, { ...second, text: "Ignored replacement", delivery: "steer" }),
    secondReceipt,
  )
  complete(heldResponses.shift(), 1)
  check("wait_until_idle", (await request("POST", `${endpoint}/wait`)).status, 204)
  check("two_model_calls", modelRequests.length, 2)
  check("inbox_drained", (await request("GET", `${endpoint}/inbox`)).data.data.length, 0)
  check(
    "idle_after_completion",
    Object.hasOwn((await request("GET", "/api/session/active")).data.data, sessionID),
    false,
  )
  const context = (await request("GET", `${endpoint}/context`)).data.data
  check(
    "serial_native_transcript",
    context.filter((message) => message.type === "user" || message.type === "assistant").map((message) => message.type),
    ["user", "assistant", "user", "assistant"],
  )
  check(
    "input_ids_once",
    context.filter((message) => message.type === "user").map((message) => message.id),
    [first.id, second.id],
  )
  check(
    "assistant_completion",
    context
      .filter((message) => message.type === "assistant")
      .map((message) => ({
        finish: message.finish,
        completed: typeof message.time.completed === "number",
        text: message.content.find((part) => part.type === "text")?.text,
      })),
    [
      { finish: "stop", completed: true, text: "Synthetic reply 1." },
      { finish: "stop", completed: true, text: "Synthetic reply 2." },
    ],
  )
  if (tuiMode) {
    const text = () => terminalOutput.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    await until(() => text().includes("Synthetic reply 2."), "native TUI renders the HTTP follow-up completion")
    check("native_tui_stays_attached", tui.exitCode, null)
    check("native_tui_renders_http_followup", text().includes("Synthetic reply 2."), true)
    const formOffset = terminalOutput.length
    check(
      "create_native_question",
      (
        await request("POST", `${endpoint}/form`, {
          id: "frm_native_probe",
          title: "Synthetic native question",
          fields: [{ key: "continue", type: "boolean", required: true }],
        })
      ).status,
      200,
    )
    await until(
      () =>
        terminalOutput
          .slice(formOffset)
          .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
          .includes("Synthetic native question"),
      "native question presentation",
    )
    terminal.write("\r")
    await until(
      async () =>
        (await request("GET", `${endpoint}/form/frm_native_probe/receipt`)).data.data.state.status === "answered",
      "native question answer",
    )
    check(
      "native_question_receipt",
      (await request("GET", `${endpoint}/form/frm_native_probe/receipt`)).data.data.state,
      { status: "answered", answer: { continue: true } },
    )
    check(
      "late_http_question_reply_rejected",
      (
        await request("POST", `${endpoint}/form/frm_native_probe/reply`, {
          answer: { continue: false },
          responseID: "late-phone-question",
        })
      ).status,
      409,
    )
    const permissionOffset = terminalOutput.length
    const permission = await request("POST", `${endpoint}/permission`, {
      id: "per_native_probe",
      action: "shell",
      resources: ["pwd"],
    })
    check("create_native_permission", permission.data.data.effect, "ask")
    await until(
      () =>
        terminalOutput
          .slice(permissionOffset)
          .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
          .includes("Permission required"),
      "native permission presentation",
    )
    terminal.write("\r")
    await until(
      async () =>
        (await request("GET", `${endpoint}/permission/per_native_probe/receipt`)).data.data.state.status === "answered",
      "native permission answer",
    )
    check(
      "native_permission_receipt",
      (await request("GET", `${endpoint}/permission/per_native_probe/receipt`)).data.data.state,
      { status: "answered", reply: "once" },
    )
    check(
      "late_http_permission_reply_rejected",
      (
        await request("POST", `${endpoint}/permission/per_native_probe/reply`, {
          reply: "reject",
          responseID: "late-phone-permission",
        })
      ).status,
      404,
    )
    tui.kill("SIGTERM")
    await tui.exited
    terminal.close()
  }
  const promoted = await request("POST", `${endpoint}/prompt`, {
    ...first,
    text: "Ignored promoted replacement",
    resume: false,
  })
  check(
    "promoted_replay_receipt",
    { status: promoted.status, id: promoted.data.data.id, text: promoted.data.data.payload.text },
    { status: 200, id: first.id, text: first.text },
  )
  check("promoted_replay_advisory_wake", (await request("POST", `${endpoint}/prompt`, first)).status, 200)
  await request("POST", `${endpoint}/wait`)
  await timers.setTimeout(100)
  check("promoted_replay_does_not_execute", modelRequests.length, 2)
  await stop("SIGKILL")
  await start()
  await timers.setTimeout(100)
  check("restart_does_not_execute", modelRequests.length, 2)
  const afterRestart = await request("POST", `${endpoint}/prompt`, first)
  check(
    "promoted_replay_after_restart",
    { status: afterRestart.status, id: afterRestart.data.data.id, text: afterRestart.data.data.payload.text },
    { status: 200, id: first.id, text: first.text },
  )
  await request("POST", `${endpoint}/wait`)
  await timers.setTimeout(100)
  check("restart_replay_does_not_execute", modelRequests.length, 2)
  check(
    "restart_transcript_unchanged",
    (await request("GET", `${endpoint}/context`)).data.data.map((message) => message.id),
    context.map((message) => message.id),
  )
  evidence.result = "passed"
} catch (error) {
  evidence.result = "failed"
  evidence.failure = {
    name: error.name,
    message: error.message.replaceAll(runtime, "<runtime>").replaceAll(password, "<redacted>"),
  }
  evidence.diagnostic = logs.replaceAll(runtime, "<runtime>").replaceAll(password, "<redacted>").slice(-4000)
  process.exitCode = 1
} finally {
  if (tui && tui.exitCode === null) {
    tui.kill("SIGKILL")
    await tui.exited
  }
  terminal?.close()
  evidence.terminalOutputBytes = tuiMode ? Buffer.byteLength(terminalOutput) : undefined
  for (const response of heldResponses) response.destroy()
  await stop()
  model.closeAllConnections()
  await new Promise((resolve) => model.close(resolve))
  evidence.modelRequests = modelRequests
  evidence.stderrBytes = Buffer.byteLength(logs)
  const kind = tuiMode ? "native-tui" : legacy ? "legacy-package" : smallContext ? "small-context" : "execution"
  await writeFile(path.join(directory, `${runtimeKind}-${kind}.json`), `${JSON.stringify(evidence, null, 2)}\n`)
  await rm(runtime, { recursive: true, force: true })
  console.log(
    JSON.stringify({
      result: evidence.result,
      runtime: evidence.runtime,
      checks: evidence.checks.length,
      modelRequests: modelRequests.length,
      failure: evidence.failure,
    }),
  )
}
