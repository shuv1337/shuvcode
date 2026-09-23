import { Clock, Duration, Effect, Schema } from "effect"
import { HttpClientResponse } from "effect/unstable/http"
import type { Snapshot, Status } from "../generation.js"
import { Media } from "../media.js"
import type { AuthInput } from "./auth.js"
import {
  AIError,
  ContentPolicyError,
  HttpContext,
  InvalidProviderOutputError,
  InvalidRequestError,
  ProviderInternalError,
} from "../schema/index.js"

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

export type Body =
  | { readonly type: "json"; readonly value: Record<string, unknown> }
  | { readonly type: "multipart"; readonly value: FormData }

export const json = (value: Record<string, unknown>): Body => ({ type: "json", value })
export const multipart = (value: FormData): Body => ({ type: "multipart", value })

// ---------------------------------------------------------------------------
// Protocol kinds
// ---------------------------------------------------------------------------

export interface DecodeContext<Request> {
  readonly request: Request
  readonly body: Body
}

/** One request, one response. JSON or multipart in; JSON or raw bytes out. */
export interface Inline<Request, Response> {
  readonly kind: "inline"
  readonly id: string
  readonly name: string
  /** Common request fields this protocol cannot lower; the route rejects them before `body.from` runs. */
  readonly unsupported?: ReadonlyArray<keyof Request & string>
  readonly body: { readonly from: (request: Request) => Effect.Effect<Body, AIError> }
  readonly response: {
    readonly decode: (
      response: HttpClientResponse.HttpClientResponse,
      context: DecodeContext<Request>,
    ) => Effect.Effect<Response, AIError>
  }
}

export const inline = <Request, Response>(
  input: Omit<Inline<Request, Response>, "kind">,
): Inline<Request, Response> => ({
  kind: "inline",
  ...input,
})

/** What `start` learned from the submission response: the route-owned handle plus the first observation. */
export interface Started<Token> {
  readonly token: Token
  readonly snapshot: Snapshot
}

/**
 * A follow-up call's inputs: the decoded token and the auth headers the route sent, so a protocol can attach them
 * to output URLs that require the same credentials to download (Veo).
 */
export interface PollContext<Token> {
  readonly token: Token
  readonly auth: Record<string, string>
}

/**
 * Submit, then poll. `start` posts the body to the route endpoint; `status`, `result`, and `cancel` are follow-up
 * calls addressed by the token. Paths are relative to the route base URL unless the provider hands back absolute
 * URLs (fal `status_url`), in which case they are used verbatim. `result` is always its own GET: providers that
 * return the output inside the status body (Veo, xAI, Runway) point `result.path` at the status path and decode the
 * same document, so `Generation.await` and `Video.resume(...).await()` behave identically everywhere.
 */
export interface Queued<Request, Response, Token> {
  readonly kind: "queued"
  readonly id: string
  readonly name: string
  /** Common request fields this protocol cannot lower; the route rejects them before `start.body.from` runs. */
  readonly unsupported?: ReadonlyArray<keyof Request & string>
  /** Serializable handle. `Generation.token` carries the encoded form so it can be persisted and resumed elsewhere. */
  readonly token: Schema.Codec<Token, unknown>
  readonly start: {
    readonly body: { readonly from: (request: Request) => Effect.Effect<Body, AIError> }
    readonly decode: (
      response: HttpClientResponse.HttpClientResponse,
      context: DecodeContext<Request>,
    ) => Effect.Effect<Started<Token>, AIError>
  }
  readonly status: {
    readonly path: (token: Token) => string
    readonly decode: (
      response: HttpClientResponse.HttpClientResponse,
      context: PollContext<Token>,
    ) => Effect.Effect<Snapshot, AIError>
  }
  readonly result: {
    readonly path: (token: Token) => string
    readonly decode: (
      response: HttpClientResponse.HttpClientResponse,
      context: PollContext<Token>,
    ) => Effect.Effect<Response, AIError>
  }
  readonly cancel?: {
    readonly method: AuthInput["method"]
    readonly path: (token: Token) => string
  }
}

export const queued = <Request, Response, Token>(
  input: Omit<Queued<Request, Response, Token>, "kind">,
): Queued<Request, Response, Token> => ({
  kind: "queued",
  ...input,
})

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

const context = (response: HttpClientResponse.HttpClientResponse) =>
  new HttpContext({ url: response.request.url, status: response.status, headers: response.headers })

/**
 * Read a text body while retaining the original payload and HTTP context on every downstream error. `invalid` is a
 * malformed provider document; `ended` is a generation that reached a terminal status without output (`failed` is
 * provider-side, `cancelled`/`expired` mean the result will never exist); `contentPolicy` is a moderated result.
 */
export const text = Effect.fn("MediaProtocol.text")(function* (
  route: string,
  name: string,
  response: HttpClientResponse.HttpClientResponse,
) {
  const http = context(response)
  const body = yield* response.text.pipe(
    Effect.mapError(
      (cause) =>
        new AIError({
          reason: new InvalidProviderOutputError({
            route,
            message: `Failed to read the ${name} response`,
            http,
            cause,
          }),
        }),
    ),
  )
  return {
    body,
    http,
    invalid: (message: string, cause?: unknown) =>
      new AIError({ reason: new InvalidProviderOutputError({ route, message, body, http, cause }) }),
    ended: (status: Exclude<Status, "queued" | "running" | "completed">, message: string) =>
      new AIError({
        reason:
          status === "failed"
            ? new ProviderInternalError({ message, body, http })
            : new InvalidRequestError({ message, body, http }),
      }),
    contentPolicy: (message: string) => new AIError({ reason: new ContentPolicyError({ message, body, http }) }),
  }
})

export type Output = Effect.Success<ReturnType<typeof text>>

/** Read and Schema-decode a JSON body. Decode failures keep the raw body as `reason.body`. */
export const decodeJson = <A>(route: string, name: string, schema: Schema.Codec<A, unknown>) => {
  const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(schema))
  return Effect.fn("MediaProtocol.decodeJson")(function* (response: HttpClientResponse.HttpClientResponse) {
    const output = yield* text(route, name, response)
    const value = yield* decode(output.body).pipe(
      Effect.mapError((cause) => output.invalid(`${name} returned an invalid response`, cause)),
    )
    return { ...output, value }
  })
}

/** Decode a submission response into the token and first snapshot. */
export const decodeStarted = <A, Token>(
  route: string,
  name: string,
  schema: Schema.Codec<A, unknown>,
  started: (value: A) => Started<Token>,
) => {
  const decode = decodeJson(route, name, schema)
  return (response: HttpClientResponse.HttpClientResponse) =>
    decode(response).pipe(Effect.map((output) => started(output.value)))
}

/** Map a provider status string through the protocol's table; unknown values are an invalid provider document. */
export const status = <Table extends Record<string, Status>>(
  table: Table,
  raw: string,
  output: Output,
): Effect.Effect<Status, AIError> => {
  const normalized: Status | undefined = table[raw]
  if (normalized === undefined) return Effect.fail(output.invalid(`Unknown generation status "${raw}"`))
  return Effect.succeed(normalized)
}

/** A `url` asset whose provider-declared retention window starts now. */
export const expiringUrl = (url: string, retention: Duration.Duration, options?: Parameters<typeof Media.url>[1]) =>
  Clock.currentTimeMillis.pipe(
    Effect.map((now) => Media.url(url, { ...options, expiresAt: now + Duration.toMillis(retention) })),
  )

export * as MediaProtocol from "./media-protocol.js"
