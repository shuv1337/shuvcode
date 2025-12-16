import z from "zod"
import { Identifier } from "../id/id"

export namespace Question {
  // Question types
  export const SelectOption = z.object({
    value: z.string(),
    label: z.string(),
    hint: z.string().optional(),
  })
  export type SelectOption = z.infer<typeof SelectOption>

  export const SelectQuestion = z.object({
    type: z.literal("select"),
    id: z.string(),
    message: z.string(),
    options: z.array(SelectOption),
    defaultValue: z.string().optional(),
  })
  export type SelectQuestion = z.infer<typeof SelectQuestion>

  export const MultiSelectQuestion = z.object({
    type: z.literal("multi-select"),
    id: z.string(),
    message: z.string(),
    options: z.array(SelectOption),
    defaultValue: z.array(z.string()).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  })
  export type MultiSelectQuestion = z.infer<typeof MultiSelectQuestion>

  export const ConfirmQuestion = z.object({
    type: z.literal("confirm"),
    id: z.string(),
    message: z.string(),
    defaultValue: z.boolean().optional(),
  })
  export type ConfirmQuestion = z.infer<typeof ConfirmQuestion>

  export const TextQuestion = z.object({
    type: z.literal("text"),
    id: z.string(),
    message: z.string(),
    placeholder: z.string().optional(),
    defaultValue: z.string().optional(),
    validate: z.string().optional(), // regex pattern for validation
  })
  export type TextQuestion = z.infer<typeof TextQuestion>

  export const Item = z.discriminatedUnion("type", [SelectQuestion, MultiSelectQuestion, ConfirmQuestion, TextQuestion])
  export type Item = z.infer<typeof Item>

  // Answer types
  export const SelectAnswer = z.object({
    type: z.literal("select"),
    id: z.string(),
    value: z.string(),
  })
  export type SelectAnswer = z.infer<typeof SelectAnswer>

  export const MultiSelectAnswer = z.object({
    type: z.literal("multi-select"),
    id: z.string(),
    values: z.array(z.string()),
  })
  export type MultiSelectAnswer = z.infer<typeof MultiSelectAnswer>

  export const ConfirmAnswer = z.object({
    type: z.literal("confirm"),
    id: z.string(),
    value: z.boolean(),
  })
  export type ConfirmAnswer = z.infer<typeof ConfirmAnswer>

  export const TextAnswer = z.object({
    type: z.literal("text"),
    id: z.string(),
    value: z.string(),
  })
  export type TextAnswer = z.infer<typeof TextAnswer>

  export const Answer = z.discriminatedUnion("type", [SelectAnswer, MultiSelectAnswer, ConfirmAnswer, TextAnswer])
  export type Answer = z.infer<typeof Answer>

  // Request/Response schemas for TUI events
  export const Request = z.object({
    questionID: Identifier.schema("question"),
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message"),
    callID: z.string(),
    questions: z.array(Item),
    title: z.string().optional(),
    timeout: z.number().optional(), // timeout in ms
  })
  export type Request = z.infer<typeof Request>

  export const ResponseStatus = z.enum(["ok", "cancel", "timeout"])
  export type ResponseStatus = z.infer<typeof ResponseStatus>

  export const Response = z.object({
    questionID: Identifier.schema("question"),
    status: ResponseStatus,
    answers: z.array(Answer).optional(),
    comment: z.string().optional(),
  })
  export type Response = z.infer<typeof Response>
}
