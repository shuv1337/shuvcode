export * as RequestSite from "./request-site"

import { Effect } from "effect"
import { FindMyWay, HttpMiddleware, HttpServerRequest, HttpServerResponse } from "effect/http"
import { type CorsOptions, isAllowedRequestOrigin } from "./cors"

// The router's own matcher with `HttpRouter`'s default configuration, so a path counts as API exactly when routing
// would send it there: case-folded, percent-decoded, and with duplicate and trailing slashes ignored. A path the
// router cannot decode matches nothing here and nothing there. Every path is looked up under one method, so the
// request's method cannot change the answer.
const apiPaths = FindMyWay.make<"api" | "artifact-view">()
apiPaths.on("GET", "/api", "api")
apiPaths.on("GET", "/api/*", "api")
// Artifact pages render in sandboxed frames, so their own requests come from an opaque origin.
apiPaths.on("GET", "/api/experimental/artifacts/:artifactID/view", "artifact-view")
apiPaths.on("GET", "/api/experimental/artifacts/:artifactID/view/*", "artifact-view")

/**
 * API routes are called by scripts and native clients, not opened as pages from other sites. Browsers label requests
 * with Sec-Fetch-Site and Sec-Fetch-Mode; another site may navigate to the API or call it only from an allowed CORS
 * origin. Clients that send no Sec-Fetch headers (CLI, TUI, SDK, mobile) and same-origin or typed-in requests pass.
 */
export function rejected(request: HttpServerRequest.HttpServerRequest, options?: CorsOptions) {
  const site = request.headers["sec-fetch-site"]
  if (site !== "cross-site" && site !== "same-site") return false
  if (apiPaths.find("GET", request.url)?.handler !== "api") return false
  if (request.headers["sec-fetch-mode"] === "navigate") return true
  const origin = request.headers.origin
  return origin !== undefined && !isAllowedRequestOrigin(origin, request.headers.host, options)
}

export const middleware = (options?: CorsOptions) =>
  HttpMiddleware.make((app) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      if (!rejected(request, options)) return yield* app
      return HttpServerResponse.jsonUnsafe(
        { _tag: "ForbiddenError", message: "Cross-site requests to the API are not allowed" },
        { status: 403 },
      )
    }),
  )
