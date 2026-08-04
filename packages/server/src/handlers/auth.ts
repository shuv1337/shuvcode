import { Integration } from "@opencode-ai/core/integration"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const AuthHandler = HttpApiBuilder.group(Api, "server.auth", (handlers) =>
  handlers.handle(
    "auth.status",
    Effect.fn(function* () {
      const integration = yield* Integration.Service
      return yield* response(integration.auth.status())
    }),
  ),
)
