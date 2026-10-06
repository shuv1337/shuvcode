import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { isolatedEnv } from "../fixture/environment"

type RequestBody = {
  input?: unknown[]
  tools?: Array<{ name?: string }>
  model?: string
}

export async function managedEval(
  scenario: "result" | "decision" | "permission" | "lead-permission" = "result",
  executable?: string,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "shuvcode-supervisor-eval-"))
  const project = path.join(root, "project")
  const home = path.join(root, "pilot")
  await mkdir(project)
  await git(project, ["init", "-b", "integration-v2"])
  await git(project, ["config", "user.name", "Fixture"])
  await git(project, ["config", "user.email", "fixture@example.test"])
  await writeFile(path.join(project, "README.md"), "# Managed pilot evaluation\n")
  await git(project, ["add", "README.md"])
  await git(project, ["commit", "-m", "chore: fixture baseline"])

  const requests: RequestBody[] = []
  const resultRequested = Promise.withResolvers<void>()
  const resultReleased = Promise.withResolvers<void>()
  const provider = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/v1/responses")
        return new Response("Not found", { status: 404 })
      const body = (await request.json()) as RequestBody
      requests.push(body)
      const wire = JSON.stringify(body.input ?? [])
      const outputs = (body.input ?? []).filter(
        (item) => typeof item === "object" && item !== null && "type" in item && item.type === "function_call_output",
      ).length
      if (scenario === "lead-permission" && wire.includes("Run lead shell check")) {
        if (outputs === 0) return call("shell", { command: "printf 'lead approved\\n'" })
        return message("Lead shell check finished")
      }
      if (wire.includes("Supervisor task: managed-fixture")) {
        if (scenario === "decision" && !wire.includes("Decision scope: Proceed")) {
          if (outputs === 0) return call("supervisor_decision", { id: "scope", question: "May I write the report?" })
          return message("Waiting for the lead's decision")
        }
        const prior = scenario === "decision" ? 1 : 0
        if (outputs === prior)
          return call("shell", {
            command:
              "printf '%s\\n' 'Managed worker result' > RESULT.md && git add RESULT.md && git commit -m 'feat: managed fixture result'",
          })
        if (outputs === prior + 1) {
          if (scenario === "decision") {
            resultRequested.resolve()
            await resultReleased.promise
          }
          return call("supervisor_result", { relativePath: "RESULT.md" })
        }
        return message("Worker submitted RESULT.md")
      }
      if (wire.includes("Supervisor verified ship result for managed-fixture"))
        return message("Verified worker result received")
      if (wire.includes("Supervisor decision pending for managed-fixture"))
        return message("Decision pending for operator")
      if (wire.includes("Build managed-fixture")) {
        if (outputs === 0)
          return call("supervisor_task", {
            name: "managed-fixture",
            brief: "Build and commit RESULT.md with the managed worker finding",
            kind: "ship",
          })
        return message("Task assigned to worker")
      }
      return message("Ready")
    },
  })

  return {
    root,
    project,
    home,
    requests,
    providerURL: `http://127.0.0.1:${provider.port}/v1`,
    resultRequested: resultRequested.promise,
    releaseResult: () => resultReleased.resolve(),
    cli: (args: string[], timeoutMs = 35_000) => cli(["supervisor", ...args], timeoutMs),
    rootCli: (args: string[], environment: Record<string, string | undefined>) => cli(args, 35_000, environment),
    async [Symbol.asyncDispose]() {
      await provider.stop(true)
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
    },
  }

  async function cli(args: string[], timeoutMs: number, environment: Record<string, string | undefined> = {}) {
    const child = Bun.spawn(
      executable
        ? [executable, ...args]
        : [process.execPath, path.join(import.meta.dir, "../../src/index.ts"), ...args],
      {
        cwd: project,
        env: isolatedEnv(root, {
          USERPROFILE: root,
          ...Object.fromEntries(
            Object.keys(process.env)
              .filter((key) => key.startsWith("HERDR_"))
              .map((key) => [key, undefined]),
          ),
          ...environment,
        }),
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const timer = setTimeout(() => child.kill(), timeoutMs)
    try {
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      return { code, stdout, stderr }
    } finally {
      clearTimeout(timer)
    }
  }
}

function call(name: string, input: unknown) {
  const id = `call_${crypto.randomUUID().replaceAll("-", "")}`
  const item = `item_${crypto.randomUUID().replaceAll("-", "")}`
  return events(
    { type: "response.output_item.added", item: { type: "function_call", id: item, call_id: id, name, arguments: "" } },
    { type: "response.function_call_arguments.delta", item_id: item, delta: JSON.stringify(input) },
    {
      type: "response.output_item.done",
      item: { type: "function_call", id: item, call_id: id, name, arguments: JSON.stringify(input) },
    },
  )
}

function message(value: string) {
  const id = `msg_${crypto.randomUUID().replaceAll("-", "")}`
  return events(
    { type: "response.output_item.added", item: { type: "message", id } },
    { type: "response.output_text.delta", item_id: id, delta: value },
    {
      type: "response.output_item.done",
      item: { type: "message", id, content: [{ type: "output_text", text: value }] },
    },
  )
}

function events(...items: unknown[]) {
  const responseID = `resp_${crypto.randomUUID().replaceAll("-", "")}`
  const frames = [
    { type: "response.created", response: { id: responseID } },
    ...items,
    {
      type: "response.completed",
      response: { id: responseID, usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 } },
    },
  ]
  return new Response(`${frames.map((item) => `data: ${JSON.stringify(item)}\n\n`).join("")}data: [DONE]\n\n`, {
    headers: { "content-type": "text/event-stream" },
  })
}

async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" })
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  if (code !== 0) throw new Error(stderr)
}
