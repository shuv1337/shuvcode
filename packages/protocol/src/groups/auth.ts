import { Auth } from "@opencode-ai/schema/auth"
import { Location } from "@opencode-ai/schema/location"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const AuthGroup = HttpApiGroup.make("server.auth")
  .add(
    HttpApiEndpoint.get("auth.status", "/api/auth/status", {
      query: LocationQuery,
      success: Location.response(Auth.Status),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.auth.status",
          summary: "Get authentication status",
          description:
            "Report locally detectable authentication readiness. This does not contact providers, verify credentials externally, refresh OAuth tokens, or expose credential values.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "auth" }))
