import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { isolatedEnv } from "../fixture/environment"

type Responder = (request: unknown) => string | Response | Promise<string | Response>

export async function createSupervisorFixture(respond: Responder = () => "fixture complete") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "shuvcode-supervisor-integration-"))
  const project = path.join(root, "project")
  const home = path.join(root, "supervisor")
  const config = path.join(root, "config")
  const models = path.join(root, "models.json")
  const plugin = path.join(import.meta.dir, "../../src/supervisor/plugin")
  const password = "supervisor-fixture-secret"
  await Promise.all([fs.mkdir(project), fs.mkdir(home), fs.mkdir(config)])
  await git(project, ["init", "-b", "integration-v2"])
  await git(project, ["config", "user.name", "Fixture"])
  await git(project, ["config", "user.email", "fixture@example.test"])
  await Bun.write(path.join(project, "README.md"), "# Supervisor fixture\n")
  await git(project, ["add", "README.md"])
  await git(project, ["commit", "-m", "chore: fixture baseline"])

  const requests: unknown[] = []
  const llm = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/v1/chat/completions")
        return new Response("Not found", { status: 404 })
      const body: unknown = await request.json()
      requests.push(body)
      const result = await respond(body)
      if (result instanceof Response) return result
      return new Response(completion(result), { headers: { "content-type": "text/event-stream" } })
    },
  })
  await Bun.write(
    path.join(config, "opencode.json"),
    JSON.stringify({
      ...providerConfig(`http://127.0.0.1:${llm.port}/v1`),
      plugins: [{ package: plugin, options: { home } }],
    }),
  )
  await Bun.write(models, "{}")

  const servers: ReturnType<typeof Bun.spawn>[] = []
  async function startServer(port = 0) {
    const server = Bun.spawn(
      [process.execPath, path.join(import.meta.dir, "../../src/index.ts"), "serve", "--stdio", "--port", String(port)],
      {
        env: isolatedEnv(root, {
          USERPROFILE: root,
          OPENCODE_SERVER_PASSWORD: password,
          OPENCODE_CONFIG_CONTENT: undefined,
          OPENCODE_DISABLE_AUTOUPDATE: "true",
          OPENCODE_MODELS_PATH: models,
        }),
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    servers.push(server)
    const url = await readURL(server.stdout)
    return { url, password, server }
  }

  return {
    root,
    project,
    home,
    llm: { requests },
    startServer,
    async [Symbol.asyncDispose]() {
      servers.forEach((server) => server.kill())
      await Promise.all(servers.map((server) => server.exited))
      await llm.stop(true)
      await fs.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
    },
  }
}

export function toolCallStream(id: string, name: string, input: unknown) {
  const chunks = [
    {
      choices: [
        {
          delta: {
            role: "assistant",
            tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: "" } }],
          },
          finish_reason: null,
        },
      ],
      usage: null,
    },
    {
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(input) } }] } }],
      usage: null,
    },
    { choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: null },
    { choices: [], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } },
  ]
  return new Response(`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`, {
    headers: { "content-type": "text/event-stream" },
  })
}

function completion(text: string) {
  const chunks = [
    { choices: [{ delta: { role: "assistant" }, finish_reason: null }], usage: null },
    { choices: [{ delta: { content: text }, finish_reason: null }], usage: null },
    { choices: [{ delta: {}, finish_reason: "stop" }], usage: null },
    { choices: [], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } },
  ]
  return `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`
}

function providerConfig(baseURL: string) {
  return {
    update: "disable",
    model: "test/test-model",
    providers: {
      test: {
        name: "Test",
        package: "aisdk:@ai-sdk/openai-compatible",
        settings: { apiKey: "fixture-key", baseURL },
        models: {
          "test-model": {
            name: "Fixture Model",
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            cost: { input: 0, output: 0 },
            limit: { context: 100_000, output: 10_000 },
          },
        },
      },
    },
  }
}

async function git(cwd: string, args: string[]) {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${new TextDecoder().decode(result.stderr)}`)
  return new TextDecoder().decode(result.stdout).trim()
}

async function readURL(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      buffer += decoder.decode(result.value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith("{")) continue
        const parsed = JSON.parse(trimmed) as { url?: string }
        if (parsed.url) return parsed.url
      }
    }
  } finally {
    reader.releaseLock()
  }
  throw new Error("fixture server did not report a URL")
}
