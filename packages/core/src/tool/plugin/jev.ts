export * as JevTool from "./jev.js"

import { type AIError, ToolFailure } from "@opencode/ai"
import {
  Evaluation,
  EvaluationAnswer,
  EvaluationClient,
  EvaluationInput,
  EvaluationQuestion,
} from "@opencode/ai/experimental"
import { TypeSafeAI } from "@opencode/ai/providers/typesafe-ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Redacted, Schema } from "effect"
import { Config } from "../../config.js"
import { ConfigEntryObserver } from "../../config/plugin/entry-observer.js"
import { Permission } from "../../permission.js"

export const namespace = "jev"
export const name = "systemOne"
export const effectiveName = `${namespace}_${name}`
export const integrationID = "typesafe-ai"
export const envName = "TYPESAFE_API_KEY"
export const defaultModel = "jev-latest"
export const NOT_CONFIGURED = `TypeSafe System One is not configured. Set ${envName} or connect TypeSafe, then try again.`

export const description = `Ask TypeSafe System One (Jev) structured questions about some material and get typed answers. Read-only: it sends \`state\` and \`questions\` to the TypeSafe API and returns its answers.

Question types:
- boolean: a yes/no question; the answer is the probability of yes.
- choice: pick one option from \`criteria\`, a map of option ID to its description; the answer is the chosen option ID.
- score: rate on the scale in \`criteria\`, ordered lowest first; the answer is a score from 0 to criteria.length - 1.

Example: { state: diff, questions: { api: { type: "boolean", instructions: "Does this diff change the public API?" } } }`

export const Input = Schema.Struct({
  state: EvaluationInput.annotate({
    description:
      "Material to evaluate, as text or a JSON object or array, such as a diff, a plan, or candidate approaches.",
  }),
  questions: Schema.Record(Schema.String, EvaluationQuestion).annotate({
    description: "One or more questions keyed by an ID you choose. Each answer is returned under the same ID.",
  }),
  model: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))).annotate({
    description: `Jev model ID. Defaults to ${defaultModel}.`,
  }),
})

export const Output = Schema.Struct({
  model: Schema.String.annotate({ description: "The model version that answered." }),
  answers: Schema.Record(Schema.String, EvaluationAnswer).annotate({
    description:
      "Answers keyed by question ID. boolean: { probability } of yes; choice: { choice, probabilities?, confidence? }; score: { score, probabilities?, confidence? }.",
  }),
})

export const Plugin = {
  id: "opencode.tool.jev",
  effect: Effect.fn("JevTool.Plugin")(function* (ctx: Context) {
    const config = yield* Config.Service
    const permission = yield* Permission.Service
    const evaluations = yield* EvaluationClient.Service
    const loaded = yield* ConfigEntryObserver.observe(
      config,
      ctx.event,
      Effect.all([ctx.integration.reload(), ctx.tool.reload()], { discard: true }),
    )
    const enabled = () => Config.latest(loaded.entries, "experimental")?.jev === true

    yield* ctx.integration
      .transform((editor) => {
        if (!enabled()) return
        editor.update(integrationID, (integration) => (integration.name = "TypeSafe"))
        editor.method.update({ integrationID, method: { type: "key" } })
        editor.method.update({ integrationID, method: { type: "env", names: [envName] } })
      })
      .pipe(Effect.orDie)

    yield* ctx.tool
      .transform((editor) => {
        if (!enabled()) return
        editor.namespace({
          name: namespace,
          description: "Ask TypeSafe System One (Jev) structured boolean, choice, and score questions.",
        })
        editor.add({
          name,
          description,
          input: Input,
          output: Output,
          options: { namespace },
          execute: (input, context) =>
            Effect.gen(function* () {
              const connection = yield* ctx.integration.connection.active(integrationID)
              const credential = connection ? yield* ctx.integration.connection.resolve(connection) : undefined
              if (credential?.type !== "key") return yield* new ToolFailure({ message: NOT_CONFIGURED })
              const model = input.model ?? defaultModel
              yield* permission.assert({
                action: effectiveName,
                resources: [model],
                save: ["*"],
                metadata: { model, questions: Object.keys(input.questions) },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              const response = yield* Evaluation.run({
                model: TypeSafeAI.configure({ apiKey: Redacted.make(credential.key) }).experimental.evaluation(model),
                state: input.state,
                questions: input.questions,
              }).pipe(
                Effect.provideService(EvaluationClient.Service, evaluations),
                Effect.mapError((error) => failure(error)),
              )
              return { output: { model: response.model, answers: response.answers }, metadata: { model } }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure
                  ? error
                  : new ToolFailure({ message: "Unable to ask TypeSafe System One", error }),
              ),
            ),
        })
      })
      .pipe(Effect.orDie)
  }),
}

// Report the reason without the error itself: transport failures can carry the authorized request.
function failure(error: AIError) {
  const reason = error.reason
  const status = reason.http?.status
  const metadata = { reason: reason._tag, ...(status === undefined ? {} : { status }) }
  const message = (() => {
    switch (reason._tag) {
      case "Authentication":
        return `TypeSafe rejected the System One credentials. Check ${envName} or the TypeSafe connection.`
      case "RateLimit":
        return "TypeSafe System One rate limited the request. Try again later."
      case "QuotaExceeded":
        return "TypeSafe System One quota exceeded."
      case "InvalidRequest":
        return `Invalid System One request: ${reason.message}`
      default:
        return `System One request failed: ${reason.message}`
    }
  })()
  return new ToolFailure({ message, metadata })
}
