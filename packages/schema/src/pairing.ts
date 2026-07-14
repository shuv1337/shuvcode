export * as Pairing from "./pairing.js"

import { Schema } from "effect"
import { ascending } from "./identifier.js"
import { statics } from "./schema.js"

const Base64Url32 = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/))

export const DeviceID = Schema.String.pipe(
  Schema.check(Schema.isStartsWith("device_")),
  Schema.brand("Pairing.DeviceID"),
  statics((schema) => ({ create: () => schema.make("device_" + ascending()) })),
)
export type DeviceID = typeof DeviceID.Type

export const InvitationToken = Base64Url32.pipe(Schema.brand("Pairing.InvitationToken"))
export type InvitationToken = typeof InvitationToken.Type

export const DeviceCredential = Schema.String.check(Schema.isPattern(/^scd_v1_[A-Za-z0-9_-]{43}$/)).pipe(
  Schema.brand("Pairing.DeviceCredential"),
)
export type DeviceCredential = typeof DeviceCredential.Type

export const RequestID = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
).pipe(Schema.brand("Pairing.RequestID"))
export type RequestID = typeof RequestID.Type

export const DeviceName = Schema.Trim.check(Schema.isMinLength(1)).pipe(Schema.brand("Pairing.DeviceName"))
export type DeviceName = typeof DeviceName.Type

export const Invitation = Schema.Struct({
  v: Schema.Literal(1),
  kind: Schema.Literal("shuvcode.pair"),
  urls: Schema.Array(Schema.String),
  token: InvitationToken,
  expiresAt: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)),
}).annotate({ identifier: "Pairing.Invitation" })
export type Invitation = typeof Invitation.Type

export const RedeemRequest = Schema.Struct({
  token: InvitationToken,
  requestID: RequestID,
  deviceName: DeviceName,
  credential: DeviceCredential,
}).annotate({ identifier: "Pairing.RedeemRequest" })
export type RedeemRequest = typeof RedeemRequest.Type

export const RedeemResponse = Schema.Struct({ deviceID: DeviceID }).annotate({
  identifier: "Pairing.RedeemResponse",
})
export type RedeemResponse = typeof RedeemResponse.Type

export const Device = Schema.Struct({
  deviceID: DeviceID,
  name: DeviceName,
  createdAt: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)),
  updatedAt: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)),
  revokedAt: Schema.optional(Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/))),
}).annotate({ identifier: "Pairing.Device" })
export type Device = typeof Device.Type

export function advertisedURLs(values: ReadonlyArray<string>) {
  return [...new Set(values.map(advertisedURL))]
}

function advertisedURL(value: string) {
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Advertised URLs must use HTTP or HTTPS")
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("Advertised URLs cannot contain userinfo, a path, query, or fragment")
  if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("Advertised HTTP URLs must be loopback")
  return url.toString().replace(/\/$/, "")
}
