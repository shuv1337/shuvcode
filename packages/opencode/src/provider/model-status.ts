import { Schema } from "effect"

// @ts-expect-error dead V1 retains the former value-style ModelsDev status re-export.
export { CatalogModelStatus } from "@opencode-ai/core/models-dev"

export const ModelStatus = Schema.Literals(["alpha", "beta", "deprecated", "active"])
export type ModelStatus = typeof ModelStatus.Type

export * as ProviderModelStatus from "./model-status"
