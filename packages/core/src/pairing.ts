export * as Pairing from "./pairing"

import { asc, eq, or } from "drizzle-orm"
import { Context, Data, Duration, Effect, Layer, Semaphore } from "effect"
import { Pairing } from "@opencode-ai/schema/pairing"
import { Database } from "./database/database"
import { makeGlobalNode } from "./effect/app-node"
import { PairingDeviceTable } from "./pairing/sql"
import { Hash } from "./util/hash"

const DEFAULT_TTL = Duration.minutes(3)
const CAPACITY = 1_024

export class Conflict extends Data.TaggedError("PairingConflict")<{
  readonly message: string
}> {}

export class InvitationUnavailable extends Data.TaggedError("PairingInvitationUnavailable")<{
  readonly message: string
}> {}

export class DeviceNotFound extends Data.TaggedError("PairingDeviceNotFound")<{
  readonly deviceID: Pairing.DeviceID
  readonly message: string
}> {}

export class InvalidRequest extends Data.TaggedError("PairingInvalidRequest")<{
  readonly message: string
}> {}

export class CapacityExceeded extends Data.TaggedError("PairingCapacityExceeded")<{
  readonly message: string
}> {}

export type Principal =
  | { readonly type: "administrator" }
  | { readonly type: "device"; readonly deviceID: Pairing.DeviceID }

export interface Interface {
  readonly issue: (input: {
    readonly urls: ReadonlyArray<string>
  }) => Effect.Effect<Pairing.Invitation, CapacityExceeded | InvalidRequest>
  readonly redeem: (
    input: Pairing.RedeemRequest,
  ) => Effect.Effect<Pairing.RedeemResponse, Conflict | InvitationUnavailable | InvalidRequest>
  readonly authenticate: (credential: string) => Effect.Effect<Principal | undefined>
  readonly list: () => Effect.Effect<ReadonlyArray<Pairing.Device>>
  readonly revoke: (deviceID: Pairing.DeviceID) => Effect.Effect<void, DeviceNotFound>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Pairing") {}

export const make = (ttl: Duration.Input = DEFAULT_TTL, capacity = CAPACITY) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const lock = Semaphore.makeUnsafe(1)
    const invitations = new Map<string, { readonly expiresAt: number }>()

    const rowDevice = (row: typeof PairingDeviceTable.$inferSelect): Pairing.Device => ({
      deviceID: row.id,
      name: row.name,
      createdAt: new Date(row.time_created).toISOString(),
      updatedAt: new Date(row.time_updated).toISOString(),
      ...(row.time_revoked === null ? {} : { revokedAt: new Date(row.time_revoked).toISOString() }),
    })

    return Service.of({
      issue: Effect.fn("Pairing.issue")(function* (input) {
        const urls = yield* Effect.try({
          try: () => Pairing.advertisedURLs(input.urls),
          catch: () => new InvalidRequest({ message: "Invalid advertised pairing URL" }),
        })
        if (urls.length === 0) return yield* new InvalidRequest({ message: "No pairing URL is available" })
        return yield* lock.withPermit(
          Effect.gen(function* () {
            const now = Date.now()
            for (const [digest, invitation] of invitations) {
              if (invitation.expiresAt <= now) invitations.delete(digest)
            }
            if (invitations.size >= capacity)
              return yield* new CapacityExceeded({ message: "Too many outstanding pairing invitations" })
            const token = Pairing.InvitationToken.make(
              Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url"),
            )
            const expiresAt = now + Duration.toMillis(Duration.fromInputUnsafe(ttl))
            invitations.set(Hash.sha256(token), { expiresAt })
            const result = {
              v: 1 as const,
              kind: "shuvcode.pair" as const,
              urls,
              token,
              expiresAt: new Date(expiresAt).toISOString(),
            }
            if (Buffer.byteLength(JSON.stringify(result)) > 4_096) {
              invitations.delete(Hash.sha256(token))
              return yield* new InvalidRequest({ message: "Pairing invitation exceeds the scanner size limit" })
            }
            return result
          }),
        )
      }),
      redeem: Effect.fn("Pairing.redeem")(function* (input) {
        if (!/^scd_v1_[A-Za-z0-9_-]{43}$/.test(input.credential))
          return yield* new InvalidRequest({ message: "Invalid device credential" })
        if (input.deviceName !== input.deviceName.trim() || Array.from(input.deviceName).length > 80)
          return yield* new InvalidRequest({ message: "Invalid device name" })
        const invitationHash = Hash.sha256(input.token)
        const credentialHash = Hash.sha256(input.credential)
        return yield* lock.withPermit(
          Effect.gen(function* () {
            const existing = yield* db
              .select()
              .from(PairingDeviceTable)
              .where(
                or(
                  eq(PairingDeviceTable.request_id, input.requestID),
                  eq(PairingDeviceTable.invitation_hash, invitationHash),
                  eq(PairingDeviceTable.credential_hash, credentialHash),
                ),
              )
              .get()
              .pipe(Effect.orDie)
            if (existing) {
              if (
                existing.request_id === input.requestID &&
                existing.invitation_hash === invitationHash &&
                existing.credential_hash === credentialHash
              )
                return { deviceID: existing.id }
              return yield* new Conflict({ message: "Pairing redemption does not match the committed enrollment" })
            }

            const invitation = invitations.get(invitationHash)
            if (!invitation || invitation.expiresAt <= Date.now()) {
              invitations.delete(invitationHash)
              return yield* new InvitationUnavailable({ message: "Pairing invitation is unavailable" })
            }
            invitations.delete(invitationHash)
            const deviceID = Pairing.DeviceID.create()
            yield* db
              .insert(PairingDeviceTable)
              .values({
                id: deviceID,
                request_id: input.requestID,
                name: input.deviceName,
                credential_hash: credentialHash,
                invitation_hash: invitationHash,
              })
              .run()
              .pipe(Effect.orDie)
            return { deviceID }
          }),
        )
      }),
      authenticate: Effect.fn("Pairing.authenticate")(function* (credential) {
        if (!/^scd_v1_[A-Za-z0-9_-]{43}$/.test(credential)) return
        const row = yield* db
          .select({ id: PairingDeviceTable.id, time_revoked: PairingDeviceTable.time_revoked })
          .from(PairingDeviceTable)
          .where(eq(PairingDeviceTable.credential_hash, Hash.sha256(credential)))
          .get()
          .pipe(Effect.orDie)
        if (!row || row.time_revoked !== null) return
        return { type: "device" as const, deviceID: row.id }
      }),
      list: Effect.fn("Pairing.list")(function* () {
        return (yield* db
          .select()
          .from(PairingDeviceTable)
          .orderBy(asc(PairingDeviceTable.time_created))
          .all()
          .pipe(Effect.orDie)).map(rowDevice)
      }),
      revoke: Effect.fn("Pairing.revoke")(function* (deviceID) {
        const row = yield* db
          .select({ id: PairingDeviceTable.id, time_revoked: PairingDeviceTable.time_revoked })
          .from(PairingDeviceTable)
          .where(eq(PairingDeviceTable.id, deviceID))
          .get()
          .pipe(Effect.orDie)
        if (!row) return yield* new DeviceNotFound({ deviceID, message: "Pairing device not found" })
        if (row.time_revoked !== null) return
        yield* db
          .update(PairingDeviceTable)
          .set({ time_revoked: Date.now() })
          .where(eq(PairingDeviceTable.id, deviceID))
          .run()
          .pipe(Effect.orDie)
      }),
    })
  })

const layer = Layer.effect(Service, make())

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
