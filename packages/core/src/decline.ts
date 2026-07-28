export * as Decline from "./decline"

import { Permission } from "./permission"
import { QuestionTool } from "./tool/plugin/question"

/**
 * A user's refusal. Leaves raise these as defects on purpose (the tunnel entered in
 * `Permission.assert` and the question tool) so the blanket `mapError` wrapping tool execution
 * cannot turn a "no" into model-facing tool output. They resurface as typed failures exactly once,
 * at the seam the session runner executes through.
 */
export type Error = Permission.DeclinedError | QuestionTool.CancelledError

/** Single definition of what counts as a tunneled decline, shared by every consumer of the tunnel. */
export const is = (value: unknown): value is Error =>
  value instanceof Permission.DeclinedError || value instanceof QuestionTool.CancelledError
