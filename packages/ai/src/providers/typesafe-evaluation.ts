import { SystemOne } from "../experimental/system-one.js"
import type { Auth } from "../route/auth.js"
import { type HttpOptions, type ModelID } from "../schema/index.js"

export const typesafeEvaluation = (input: {
  readonly id: string | ModelID
  readonly provider: string
  readonly auth: Auth.Definition
  readonly baseURL: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions
}) =>
  SystemOne.model({
    id: input.id,
    provider: input.provider,
    providerMetadataKey: "typesafe",
    auth: input.auth,
    baseURL: input.baseURL,
    headers: input.headers,
    http: input.http,
  })
