// @shuvcode/goal-plugin: one explicit objective per Session with bounded
// automatic continuation, structured completion evidence, and durable
// lifecycle state. See specs/v2/goal-plugin.md for the full contract.

import { Plugin } from "@opencode-ai/plugin"
import { randomUUID } from "node:crypto"
import { SOURCE, commandTemplate } from "./prompt"
import type { GoalOptions } from "./service"
import { createGoalService, mergeLimits } from "./service"
import { DEFAULT_LIMITS } from "./state"

export default Plugin.define({
  id: SOURCE,
  setup: async (ctx) => {
    const options = normalizeOptions(ctx.options)
    const service = createGoalService({
      options,
      owner: { pid: process.pid, instance: randomUUID(), created: Date.now() },
      now: () => Date.now(),
      session: {
        get: (input) => ctx.session.get(input),
        synthetic: (input) => ctx.session.synthetic(input),
      },
      log: (message, data) => console.log(`${message} ${JSON.stringify(data)}`),
    })

    const commands = await ctx.command.list()
    if (commands.data.some((command) => command.name === options.command))
      throw new Error(
        `goal plugin: a "${options.command}" command already exists; configure a different name through the "command" plugin option`,
      )

    await ctx.command.transform((draft) => {
      draft.add({
        name: options.command,
        description: "Start or manage a bounded Session goal",
        execute: async (input) => {
          await ctx.session.prompt({
            sessionID: input.sessionID,
            text: commandTemplate().replace("$ARGUMENTS", () => input.prompt.text),
            files: input.prompt.files,
            agents: input.prompt.agents,
            skills: input.prompt.skills,
            delivery: input.delivery,
          })
        },
      })
    })

    const { createGoalTools } = await import("./tools")
    await ctx.tool.transform((draft) => {
      for (const tool of createGoalTools(service)) draft.add(tool)
    })

    await ctx.session.hook("context", async (event) => {
      const block = await service.context(event.sessionID)
      if (!block) return
      event.system.push({ type: "text", text: block })
    })

    const iterator = ctx.event.subscribe()[Symbol.asyncIterator]()
    const consumer = consume()
    async function consume(): Promise<void> {
      while (true) {
        const next = await iterator.next()
        if (next.done) return
        await service.handleEvent(next.value).catch((error: unknown) => {
          console.log(`goal.event.error ${JSON.stringify({ error: String(error) })}`)
        })
      }
    }

    return async () => {
      await Promise.resolve(iterator.return?.()).then(
        () => undefined,
        () => undefined,
      )
      await consumer.then(
        () => undefined,
        () => undefined,
      )
      await service.dispose()
    }
  },
})

/** Decode authored snake_case options; any invalid field fails plugin setup. */
export function normalizeOptions(input: Record<string, unknown>): GoalOptions {
  const known = new Set(["command", "limits", "persistence", "verification"])
  for (const key of Object.keys(input)) {
    if (!known.has(key)) throw new Error(`goal plugin: unknown option "${key}"`)
  }

  const command = input.command === undefined ? "goal" : input.command
  if (typeof command !== "string" || !/^[A-Za-z][\w-]*$/.test(command))
    throw new Error(`goal plugin: option "command" must be a simple command name`)

  const limits = mergeLimits(DEFAULT_LIMITS, input.limits)
  if (typeof limits === "string") throw new Error(`goal plugin: option "limits" is invalid: ${limits}`)

  const persistence = decodePersistence(input.persistence)

  const verification = input.verification
  if (verification !== undefined) {
    if (typeof verification !== "object" || verification === null || Array.isArray(verification))
      throw new Error(`goal plugin: option "verification" must be an object`)
    const mode = (verification as Record<string, unknown>).mode
    if (mode !== undefined && mode !== "evidence")
      throw new Error(`goal plugin: option "verification.mode" supports only "evidence"`)
  }

  return { command, limits, persistence }
}

function decodePersistence(input: unknown): GoalOptions["persistence"] {
  if (input === undefined) return { enabled: true }
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new Error(`goal plugin: option "persistence" must be an object`)
  const record = input as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (key !== "enabled" && key !== "root") throw new Error(`goal plugin: unknown option "persistence.${key}"`)
  }
  const enabled = record.enabled === undefined ? true : record.enabled
  if (typeof enabled !== "boolean") throw new Error(`goal plugin: option "persistence.enabled" must be a boolean`)
  const root = record.root
  if (root !== undefined && (typeof root !== "string" || root.length === 0))
    throw new Error(`goal plugin: option "persistence.root" must be a non-empty path`)
  return { enabled, ...(root === undefined ? {} : { root }) }
}
