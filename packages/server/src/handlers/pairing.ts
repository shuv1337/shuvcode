import { Pairing } from "@opencode-ai/core/pairing"
import {
  InvalidRequestError,
  PairingConflictError,
  PairingDeviceNotFoundError,
  PairingInvitationUnavailableError,
  ServiceUnavailableError,
} from "@opencode-ai/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ServerInfo } from "../server-info"

const pairingError = (error: Pairing.Conflict | Pairing.InvitationUnavailable | Pairing.InvalidRequest) => {
  if (error._tag === "PairingConflict") return new PairingConflictError({ message: error.message })
  if (error._tag === "PairingInvalidRequest") return new InvalidRequestError({ message: error.message })
  return new PairingInvitationUnavailableError({ message: error.message })
}

export const PairingHandler = HttpApiBuilder.group(Api, "server.pairing", (handlers) =>
  handlers
    .handle("pairing.invitation.create", () =>
      Effect.gen(function* () {
        const pairing = yield* Pairing.Service
        const server = yield* ServerInfo.Service
        return yield* pairing
          .issue({ urls: server.urls() })
          .pipe(Effect.mapError((error) => new ServiceUnavailableError({ message: error.message, service: "pairing" })))
      }),
    )
    .handle("pairing.redeem", (ctx) =>
      Pairing.Service.use((pairing) => pairing.redeem(ctx.payload)).pipe(Effect.mapError(pairingError)),
    )
    .handle("pairing.device.list", () => Pairing.Service.use((pairing) => pairing.list()))
    .handle("pairing.device.revoke", (ctx) =>
      Pairing.Service.use((pairing) => pairing.revoke(ctx.params.deviceID)).pipe(
        Effect.mapError(
          (error) => new PairingDeviceNotFoundError({ deviceID: error.deviceID, message: error.message }),
        ),
      ),
    ),
)
