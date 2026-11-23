export * as GoogleSolsticeWire from "./wire"

import type { ModelEditor } from "@opencode/plugin/effect/model"
import type { ProviderEditor } from "@opencode/plugin/effect/provider"
import { Model, Provider } from "@opencode/plugin/effect"
import { GoogleSolsticeOAuth } from "./oauth"

export const inferenceBaseURL = "https://generativelanguage.googleapis.com/v1alpha"
export const defaultModelID = Model.ID.make("gemini-4-neon")
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
    id: "gemini-4-neon",
    name: "Gemini 4 Neon",
    family: "gemini",
    limit: { context: 1_048_576, output: 65_536 },
    efforts: ["low", "medium", "high", "xhigh"],
    minOutput: 65_536,
  },
  {
    id: "gemini-4-hydrogen",
    name: "Gemini 4 Hydrogen",
    family: "gemini",
    limit: { context: 1_048_576, output: 65_536 },
    efforts: ["low", "medium", "high", "xhigh"],
    minOutput: 65_536,
  },
  {
    id: "gemini-4-carbon",
    name: "Gemini 4 Carbon",
    family: "gemini",
    limit: { context: 1_048_576, output: 65_536 },
    efforts: ["low", "medium", "high"],
    minOutput: 65_536,
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

export type GoogleMode = "none" | "solstice" | "legacy"

export function applyProvider(evt: ProviderEditor, mode: GoogleMode) {
  if (mode === "none") return
  if (mode === "legacy") {
    evt.update(googleProviderID, (provider) => {
      provider.activation = "disabled"
    })
    return
  }
  evt.update(googleProviderID, (provider) => {
    provider.package = "@opencode/ai/providers/google"
    provider.integrationID = GoogleSolsticeOAuth.integrationID
    if (!provider.name || provider.name === provider.id) provider.name = "Google"
    provider.settings = {
      ...provider.settings,
      chunkTimeout: provider.settings?.chunkTimeout ?? CHUNK_TIMEOUT_MS,
    }
  })
}

export function applyModels(evt: ModelEditor, mode: GoogleMode, catalogModelIDs?: ReadonlySet<string>) {
  if (mode === "none") return
  const catalog = evt.provider.get(googleProviderID)?.models
  const existingIDs = new Set([
    ...(catalog?.keys() ?? []),
    ...evt.list(googleProviderID).map((model) => String(model.id)),
  ])
  if (mode === "legacy") {
    for (const id of existingIDs) {
      evt.update(googleProviderID, id, (draft) => {
        draft.enabled = false
      })
    }
    return
  }
  for (const model of shippedModels) {
    evt.update(googleProviderID, model.id, (draft) => {
      draft.modelID = Model.ID.make(model.id)
      draft.cost = []
      draft.enabled = true
      draft.status = "active"
      draft.package = "@opencode/ai/providers/google"
      // Always emit native GenerateContent thinkingConfig variants: catalog entries resolved under
      // google/interactions carry top-level thinkingLevel/thinkingSummaries, which Gemini GenerateContent ignores.
      draft.variants = model.efforts.map((effort) => ({
        id: Model.VariantID.make(effort),
        settings: { thinkingConfig: { includeThoughts: true, thinkingLevel: effort } },
      }))
      const isCataloged = catalogModelIDs ? catalogModelIDs.has(model.id) : Boolean(catalog?.has(model.id))
      if (!isCataloged) {
        draft.name = model.name
        draft.family = Model.Family.make(model.family)
        draft.limit = { ...model.limit }
        draft.capabilities = {
          tools: true,
          input: ["text", "image", "audio", "video", "pdf"],
          output: ["text"],
        }
        return
      }
      if (model.minOutput) {
        draft.limit = { ...draft.limit, output: Math.max(draft.limit.output, model.minOutput) }
      }
    })
  }
  for (const id of existingIDs) {
    if (shippedIDs.has(id)) continue
    evt.update(googleProviderID, id, (draft) => {
      draft.cost = []
      // Only hide pre-config catalog models; brand-new slugs configured in opencode.json stay enabled.
      if (!catalogModelIDs || catalogModelIDs.has(id)) draft.enabled = false
    })
  }
}
