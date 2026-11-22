export * as GoogleSolsticeWire from "./wire"

import type { ModelEditor } from "@opencode/plugin/effect/model"
import type { ProviderEditor } from "@opencode/plugin/effect/provider"
import { Model, Provider } from "@opencode/plugin/effect"
import { GoogleSolsticeOAuth } from "./oauth"

export const inferenceBaseURL = "https://generativelanguage.googleapis.com/v1alpha"
export const defaultModelID = Model.ID.make("gemini-3.1-pro-preview")
export const googleProviderID = Provider.ID.google
// Google recommends a 20-minute streaming chunk timeout for Gemini 4 thinking/re-prefill pauses.
export const CHUNK_TIMEOUT_MS = 1_200_000

const GOOGLE_ORIGIN = "https://generativelanguage.googleapis.com"
const GENERATE_PATH = /^(.*)\/models\/([^/:?]+):(streamGenerateContent|generateContent)(?:PerUserQuota)?$/

export type ShippedModel = {
  readonly id: string
  readonly name: string
  readonly family: string
  readonly limit: { readonly context: number; readonly output: number }
  readonly efforts: readonly string[]
  readonly minOutput?: number
}

export const shippedModels: readonly ShippedModel[] = [
  {
    id: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro Preview",
    family: "gemini-pro",
    limit: { context: 1_048_576, output: 65_536 },
    efforts: ["low", "medium", "high"],
  },
  {
    id: "gemini-4-argon",
    name: "Gemini 4 Argon",
    family: "gemini",
    limit: { context: 1_048_576, output: 65_536 },
    efforts: ["low", "medium", "high"],
    minOutput: 65_536,
  },
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    family: "gemini-flash",
    limit: { context: 1_048_576, output: 65_536 },
    efforts: ["low", "medium", "high"],
  },
  {
    id: "gemini-3.5-flash-lite",
    name: "Gemini 3.5 Flash Lite",
    family: "gemini-flash-lite",
    limit: { context: 1_048_576, output: 65_536 },
    efforts: ["minimal", "low", "medium", "high"],
  },
]

const shippedIDs = new Set(shippedModels.map((model) => model.id))

export function rewriteGenerateURL(rawURL: string): string | undefined {
  if (!URL.canParse(rawURL)) return undefined
  const url = new URL(rawURL)
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined
  const match = GENERATE_PATH.exec(url.pathname)
  if (!match) return undefined
  const prefix = match[1] ?? ""
  const model = match[2]
  const method = match[3]
  if (!model || !method) return undefined
  const target =
    url.origin === GOOGLE_ORIGIN
      ? new URL(`${inferenceBaseURL}/models/${model}:${method}PerUserQuota`)
      : new URL(`${url.origin}${rewriteVersionPrefix(prefix)}/models/${model}:${method}PerUserQuota`)
  url.searchParams.forEach((value, key) => {
    if (key === "key") return
    target.searchParams.append(key, value)
  })
  if (method === "streamGenerateContent") target.searchParams.set("alt", "sse")
  return target.toString()
}

function rewriteVersionPrefix(prefix: string): string {
  if (/\/v1beta(?=\/|$)/.test(prefix)) return prefix.replace(/\/v1beta(?=\/|$)/, "/v1alpha")
  return prefix || "/v1alpha"
}

export function applyRequestHeaders(headers: Headers, accessToken: string) {
  headers.delete("x-goog-api-key")
  headers.set("Authorization", `Bearer ${accessToken}`)
}

export function applyProvider(evt: ProviderEditor, active: boolean) {
  if (!active) return
  evt.update(googleProviderID, (provider) => {
    if (!provider.package) provider.package = "@opencode/ai/providers/google"
    provider.integrationID = GoogleSolsticeOAuth.integrationID
    if (!provider.name || provider.name === provider.id) provider.name = "Google"
    provider.settings = {
      ...provider.settings,
      chunkTimeout: provider.settings?.chunkTimeout ?? CHUNK_TIMEOUT_MS,
    }
  })
}

export function applyModels(evt: ModelEditor, active: boolean) {
  if (!active) return
  const catalog = evt.provider.get(googleProviderID)?.models
  for (const model of shippedModels) {
    evt.update(googleProviderID, model.id, (draft) => {
      draft.modelID = Model.ID.make(model.id)
      draft.cost = []
      draft.enabled = true
      draft.status = "active"
      if (!draft.package) draft.package = "@opencode/ai/providers/google"
      if (!catalog?.has(model.id)) {
        draft.name = model.name
        draft.family = Model.Family.make(model.family)
        draft.limit = { ...model.limit }
        draft.capabilities = {
          tools: true,
          input: ["text", "image", "audio", "video", "pdf"],
          output: ["text"],
        }
        draft.variants = model.efforts.map((effort) => ({
          id: Model.VariantID.make(effort),
          settings: { thinkingConfig: { includeThoughts: true, thinkingLevel: effort } },
        }))
        return
      }
      if (model.minOutput) {
        draft.limit = { ...draft.limit, output: Math.max(draft.limit.output, model.minOutput) }
      }
    })
  }
  const existingIDs = new Set([
    ...(catalog?.keys() ?? []),
    ...evt.list(googleProviderID).map((model) => String(model.id)),
  ])
  for (const id of existingIDs) {
    if (shippedIDs.has(id)) continue
    evt.update(googleProviderID, id, (draft) => {
      draft.cost = []
      draft.enabled = false
    })
  }
}
