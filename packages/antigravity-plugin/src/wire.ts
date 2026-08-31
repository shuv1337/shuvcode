export * as GoogleAntigravityWire from "./wire"

import type { CatalogDraft } from "@opencode-ai/plugin/effect/catalog"
import { Model, Provider } from "@opencode-ai/plugin/effect"
import { createHash, randomUUID } from "node:crypto"
import { Option, Schema } from "effect"
import { GoogleAntigravityOAuth } from "./oauth"

export const generateURL = `${GoogleAntigravityOAuth.cloudCodeEndpoint}/v1internal:streamGenerateContent?alt=sse`
export const defaultModelID = Model.ID.make("gemini-3.7-flash-high")
export const googleProviderID = Provider.ID.google

const FLASH_LIMIT = { context: 1_048_576, output: 65_536 }

export type ShippedModel = {
  id: string
  name: string
  apiID?: string
  modelEnum?: string
}

export const shippedModels: readonly ShippedModel[] = [
  { id: "gemini-3.7-flash-high", name: "Gemini 3.7 Flash (High)", modelEnum: "MODEL_PLACEHOLDER_M298" },
  { id: "gemini-3.7-flash-medium", name: "Gemini 3.7 Flash (Medium)", modelEnum: "MODEL_PLACEHOLDER_M299" },
  { id: "gemini-3.7-flash-low", name: "Gemini 3.7 Flash (Low)", modelEnum: "MODEL_PLACEHOLDER_M300" },
  { id: "gemini-3.6-flash-high", name: "Gemini 3.6 Flash (High)" },
  { id: "gemini-3.6-flash-medium", name: "Gemini 3.6 Flash (Medium)" },
  { id: "gemini-3.6-flash-low", name: "Gemini 3.6 Flash (Low)" },
  { id: "gemini-3-flash-agent", name: "Gemini 3.5 Flash (High)" },
  { id: "gemini-3.5-flash-low", name: "Gemini 3.5 Flash (Medium)" },
  { id: "gemini-pro-agent", name: "Gemini 3.1 Pro (High)" },
  { id: "gemini-3.1-pro-high", name: "Gemini 3.1 Pro (High)", apiID: "gemini-pro-agent" },
  { id: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro (Low)" },
]

const shippedIDs = new Set(shippedModels.map((model) => model.id))
const aliases: Record<string, string> = { "gemini-3.1-pro-high": "gemini-pro-agent" }

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

export const modelEnumDefaults = new Map(
  shippedModels.flatMap((model) => (model.modelEnum ? [[model.id, model.modelEnum] as const] : [])),
)

export const catalogID = (id: string) => aliases[id] ?? id

export const isGenerateURL = (url: string) => url.includes("streamGenerateContent") || url.includes("generateContent")

export const modelFromURL = (url: string) => {
  const match = url.match(/\/models\/([^/:?]+)/)
  return match?.[1]
}

export const isBlockedModelID = (id: string) => {
  const lower = id.toLowerCase()
  if (lower.startsWith("claude") || lower.startsWith("gpt") || lower.includes("gpt-oss")) return true
  if (lower.startsWith("tab_") || lower.startsWith("chat_")) return true
  if (lower.includes("image")) return true
  return false
}

export const isGoogleCatalogModel = (model: GoogleAntigravityOAuth.CatalogModel) => {
  if (model.internal) return false
  if (isBlockedModelID(model.id)) return false
  if (model.provider && model.provider !== "MODEL_PROVIDER_GOOGLE") return false
  return true
}

export const filterGoogleModels = (models: readonly GoogleAntigravityOAuth.CatalogModel[]) =>
  models.filter(isGoogleCatalogModel)

export function modelEnumsFrom(models: readonly GoogleAntigravityOAuth.CatalogModel[]) {
  const next = new Map(modelEnumDefaults)
  for (const model of models) {
    if (model.modelEnum) next.set(model.id, model.modelEnum)
  }
  return next
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * Strips JSON Schema keywords Cloud Code rejects. Known limitation: a `$ref` is dropped rather
 * than resolved, so a tool parameter defined only by reference degrades to untyped.
 */
export function cleanSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanSchema)
  if (!isRecord(value)) return value
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    if (key === "$ref" || key === "$defs" || key === "$schema" || key === "default") continue
    if (key === "const") {
      result.enum = [cleanSchema(value[key])]
      continue
    }
    result[key] = cleanSchema(value[key])
  }
  return result
}

function cleanTool(tool: unknown) {
  if (!isRecord(tool) || !Array.isArray(tool.functionDeclarations)) return tool
  return {
    ...tool,
    functionDeclarations: tool.functionDeclarations.map((declaration) => {
      if (!isRecord(declaration) || !("parameters" in declaration)) return declaration
      return { ...declaration, parameters: cleanSchema(declaration.parameters) }
    }),
  }
}

function withSystemRole(systemInstruction: unknown) {
  if (!isRecord(systemInstruction)) return systemInstruction
  return { role: "user", ...systemInstruction }
}

function sessionNumber(sessionID: string) {
  // Unsigned: a signed read yields a negative id for half of all Session IDs.
  return String(createHash("sha256").update(sessionID).digest().readBigUInt64BE(0))
}

function safeSession(sessionID: string) {
  return sessionID.replace(/[^a-zA-Z0-9_-]/g, "") || "session"
}

export function wrapGenerateRequest(input: {
  body: unknown
  projectId: string
  model: string
  sessionID: string
  modelEnum?: string
  now?: number
  trajectory?: string
}) {
  if (isRecord(input.body) && isRecord(input.body.request) && typeof input.body.project === "string") return input.body
  const native = isRecord(input.body) ? input.body : {}
  const tools = Array.isArray(native.tools) ? native.tools.map(cleanTool) : undefined
  const trajectory = input.trajectory ?? randomUUID()
  const now = input.now ?? Date.now()
  const model = catalogID(input.model)
  const generationConfig = isRecord(native.generationConfig) ? { ...native.generationConfig } : undefined
  if (generationConfig && isRecord(generationConfig.thinkingConfig)) {
    generationConfig.thinkingConfig = { includeThoughts: true, ...generationConfig.thinkingConfig }
  }
  return {
    project: input.projectId,
    requestId: `agent/${safeSession(input.sessionID)}/${now}/${trajectory}/2`,
    model,
    userAgent: "antigravity",
    requestType: "agent",
    request: {
      ...native,
      ...(native.systemInstruction ? { systemInstruction: withSystemRole(native.systemInstruction) } : {}),
      ...(tools ? { tools } : {}),
      ...(tools && tools.length > 0 ? { toolConfig: { functionCallingConfig: { mode: "VALIDATED" } } } : {}),
      ...(generationConfig ? { generationConfig } : {}),
      labels: {
        last_step_index: "1",
        ...(input.modelEnum ? { model_enum: input.modelEnum } : {}),
        request_id: `${trajectory}-0`,
        trajectory_id: trajectory,
        used_claude: "false",
        used_claude_conservative: "false",
        used_non_gemini_model: "false",
      },
      sessionId: sessionNumber(input.sessionID),
    },
  }
}

export function applyRequestHeaders(headers: Headers, accessToken: string) {
  headers.delete("x-goog-api-key")
  headers.set("Authorization", `Bearer ${accessToken}`)
  headers.set("User-Agent", GoogleAntigravityOAuth.userAgent())
  headers.set("Content-Type", "application/json")
}

export function unwrapDataLine(line: string) {
  if (!line.startsWith("data:")) return line
  const payload = line.slice(5).trim()
  if (!payload || payload === "[DONE]") return line
  const parsed = Option.getOrUndefined(decodeJson(payload))
  if (!isRecord(parsed) || !("response" in parsed)) return line
  return `data: ${JSON.stringify(parsed.response)}`
}

export function unwrapSSEText(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => (line.startsWith("data:") ? unwrapDataLine(line) : line))
    .join("\n")
}

export function unwrapSSE() {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let pending = ""
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true })
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ""
      for (const line of lines) controller.enqueue(encoder.encode(`${unwrapDataLine(line)}\n`))
    },
    flush(controller) {
      pending += decoder.decode()
      if (pending.length > 0) controller.enqueue(encoder.encode(unwrapDataLine(pending)))
    },
  })
}

export function applyCatalog(evt: CatalogDraft, active: boolean) {
  if (!active) return
  evt.provider.update(googleProviderID, (provider) => {
    if (!provider.package) provider.package = "@opencode-ai/ai/providers/google"
    provider.integrationID = GoogleAntigravityOAuth.integrationID
    if (!provider.name || provider.name === provider.id) provider.name = "Google"
  })
  // Antigravity model ids are absent from the upstream catalog, so synthesized
  // entries receive the generic fallback limits (200k/32k), not real Gemini
  // limits. Only a real catalog entry's limit wins over the Flash numbers.
  const cataloged = new Set(evt.provider.get(googleProviderID)?.models.keys() ?? [])
  for (const model of shippedModels) {
    evt.model.update(googleProviderID, model.id, (draft) => {
      draft.modelID = Model.ID.make(model.apiID ?? model.id)
      draft.name = model.name
      draft.cost = []
      draft.enabled = true
      draft.status = "active"
      if (!cataloged.has(model.id)) draft.limit = { ...FLASH_LIMIT }
      draft.capabilities = { tools: true, input: ["text", "image"], output: ["text"] }
      if (!draft.package) draft.package = "@opencode-ai/ai/providers/google"
    })
  }
  const item = evt.provider.get(googleProviderID)
  if (item) {
    for (const id of item.models.keys()) {
      if (shippedIDs.has(id)) continue
      evt.model.update(googleProviderID, id, (draft) => {
        draft.enabled = false
      })
    }
  }
  evt.model.default.set(googleProviderID, defaultModelID)
}
