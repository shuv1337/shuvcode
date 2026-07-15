import { Pairing } from "@opencode-ai/schema/pairing"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import {
  ForbiddenError,
  InvalidRequestError,
  PairingConflictError,
  PairingDeviceNotFoundError,
  PairingInvitationUnavailableError,
  UnauthorizedError,
  ServiceUnavailableError,
} from "../errors.js"

export const PairingGroup = HttpApiGroup.make("server.pairing")
  .add(
    HttpApiEndpoint.post("pairing.invitation.create", "/api/pairing/invitation", {
      success: Pairing.Invitation,
      error: [UnauthorizedError, ForbiddenError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({ identifier: "v2.pairing.invitation.create", summary: "Create pairing invitation" }),
    ),
  )
  .add(
    HttpApiEndpoint.post("pairing.redeem", "/api/pairing/redeem", {
      payload: Pairing.RedeemRequest,
      success: Pairing.RedeemResponse,
      error: [InvalidRequestError, PairingConflictError, PairingInvitationUnavailableError],
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.pairing.redeem", summary: "Redeem pairing invitation" })),
  )
  .add(
    HttpApiEndpoint.get("pairing.device.list", "/api/pairing/device", {
      success: Schema.Array(Pairing.Device),
      error: [UnauthorizedError, ForbiddenError],
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.pairing.device.list", summary: "List paired devices" })),
  )
  .add(
    HttpApiEndpoint.delete("pairing.device.revoke", "/api/pairing/device/:deviceID", {
      params: { deviceID: Pairing.DeviceID },
      success: HttpApiSchema.NoContent,
      error: [UnauthorizedError, ForbiddenError, PairingDeviceNotFoundError],
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.pairing.device.revoke", summary: "Revoke paired device" })),
  )
  .annotateMerge(OpenApi.annotations({ title: "pairing" }))
