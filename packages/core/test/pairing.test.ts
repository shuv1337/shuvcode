import { describe, expect } from "bun:test"
import { Deferred, Duration, Effect, Exit, Fiber, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Pairing } from "@opencode-ai/core/pairing"
import { PairingDeviceTable } from "@opencode-ai/core/pairing/sql"
import { Database } from "@opencode-ai/core/database/database"
import { DeviceCredential, DeviceName, type InvitationToken, RequestID } from "@opencode-ai/schema/pairing"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.merge(LayerNode.compile(Pairing.node), LayerNode.compile(Database.node)))
const credential = DeviceCredential.make("scd_v1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
const requestID = RequestID.make("1da45bb5-9a85-4a29-955b-c7d6d74f13de")

describe("Pairing.Service", () => {
  it.effect("enrolls once, reconciles exact retries, and authenticates the device", () =>
    Effect.gen(function* () {
      const pairing = yield* Pairing.Service
      const invitation = yield* pairing.issue({ urls: ["https://shuvdev.example"] })
      const input = {
        token: invitation.token,
        requestID,
        deviceName: DeviceName.make("Shuv's iPhone"),
        credential,
      }

      const enrolled = yield* pairing.redeem(input)
      expect(yield* pairing.redeem(input)).toEqual(enrolled)
      expect(yield* pairing.authenticate(credential)).toEqual({ type: "device", deviceID: enrolled.deviceID })
      expect(yield* pairing.list()).toHaveLength(1)
    }),
  )

  it.effect("consumes an invitation once and rejects changed retries", () =>
    Effect.gen(function* () {
      const pairing = yield* Pairing.Service
      const invitation = yield* pairing.issue({ urls: ["https://shuvdev.example"] })
      yield* pairing.redeem({
        token: invitation.token,
        requestID,
        deviceName: DeviceName.make("Phone"),
        credential,
      })

      const changed = yield* pairing
        .redeem({
          token: invitation.token,
          requestID: RequestID.make("6cf0f5d4-d96a-4909-a7f2-69416da670d6"),
          deviceName: DeviceName.make("Phone"),
          credential: DeviceCredential.make("scd_v1_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"),
        })
        .pipe(Effect.flip)
      expect(changed._tag).toBe("PairingConflict")
    }),
  )

  it.effect("revokes one credential without affecting another", () =>
    Effect.gen(function* () {
      const pairing = yield* Pairing.Service
      const first = yield* pairing.issue({ urls: ["https://shuvdev.example"] })
      const firstDevice = yield* pairing.redeem({
        token: first.token,
        requestID,
        deviceName: DeviceName.make("Phone"),
        credential,
      })
      const secondCredential = DeviceCredential.make("scd_v1_CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC")
      const second = yield* pairing.issue({ urls: ["https://shuvdev.example"] })
      const secondDevice = yield* pairing.redeem({
        token: second.token,
        requestID: RequestID.make("0fcfa724-fae1-4610-91bd-7cb78ec36f89"),
        deviceName: DeviceName.make("iPad"),
        credential: secondCredential,
      })

      yield* pairing.revoke(firstDevice.deviceID)
      expect(yield* pairing.authenticate(credential)).toBeUndefined()
      expect(yield* pairing.authenticate(secondCredential)).toEqual({ type: "device", deviceID: secondDevice.deviceID })
    }),
  )

  it.effect("serializes concurrent exact redemptions to one durable device", () =>
    Effect.gen(function* () {
      const pairing = yield* Pairing.Service
      const invitation = yield* pairing.issue({ urls: ["https://shuvdev.example"] })
      const input = {
        token: invitation.token,
        requestID: RequestID.make("e3b12d77-d8c0-45ee-9942-694ab055b8ad"),
        deviceName: DeviceName.make("Concurrent Phone"),
        credential: DeviceCredential.make("scd_v1_EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE"),
      }

      const results = yield* Effect.all([pairing.redeem(input), pairing.redeem(input)], { concurrency: 2 })
      expect(results[0]).toEqual(results[1])
      expect((yield* pairing.list()).filter((device) => device.deviceID === results[0].deviceID)).toHaveLength(1)
    }),
  )

  it.live("keeps issuance independent while an unrelated redemption waits on storage", () =>
    Effect.gen(function* () {
      const pairing = yield* Pairing.Service
      const database = yield* Database.Service
      const invitation = yield* pairing.issue({ urls: ["https://shuvdev.example"] })
      const transactionStarted = yield* Deferred.make<void>()
      const releaseTransaction = yield* Deferred.make<void>()
      const transaction = yield* database.db
        .transaction(() =>
          Deferred.succeed(transactionStarted, undefined).pipe(Effect.andThen(Deferred.await(releaseTransaction))),
        )
        .pipe(Effect.forkScoped)
      yield* Deferred.await(transactionStarted)
      const redemption = yield* pairing
        .redeem({
          token: invitation.token,
          requestID: RequestID.make("f94cd2d0-40be-4d3b-b876-4bfc31f70027"),
          deviceName: DeviceName.make("Independent Phone"),
          credential: DeviceCredential.make("scd_v1_OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO"),
        })
        .pipe(Effect.forkScoped)
      yield* Effect.yieldNow

      expect(yield* pairing.issue({ urls: ["https://shuvdev.example"] }).pipe(Effect.timeout("100 millis"))).toEqual(
        expect.objectContaining({ kind: "shuvcode.pair" }),
      )
      yield* Deferred.succeed(releaseTransaction, undefined)
      yield* Fiber.join(transaction)
      expect((yield* Fiber.join(redemption)).deviceID).toStartWith("device_")
    }),
  )

  it.effect("redeems unrelated invitations concurrently without cross-token interference", () =>
    Effect.gen(function* () {
      const pairing = yield* Pairing.Service
      const first = yield* pairing.issue({ urls: ["https://shuvdev.example"] })
      const second = yield* pairing.issue({ urls: ["https://shuvdev.example"] })
      const devices = yield* Effect.all(
        [
          pairing.redeem({
            token: first.token,
            requestID: RequestID.make("716cb8b5-6e73-4584-b65b-47e2f6ffde90"),
            deviceName: DeviceName.make("First Independent Phone"),
            credential: DeviceCredential.make("scd_v1_PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP"),
          }),
          pairing.redeem({
            token: second.token,
            requestID: RequestID.make("67fd50f9-410c-48f1-a8bb-54f61349870a"),
            deviceName: DeviceName.make("Second Independent Phone"),
            credential: DeviceCredential.make("scd_v1_QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ"),
          }),
        ],
        { concurrency: 2 },
      )

      expect(devices[0].deviceID).not.toBe(devices[1].deviceID)
      expect(yield* pairing.list()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "First Independent Phone" }),
          expect.objectContaining({ name: "Second Independent Phone" }),
        ]),
      )
    }),
  )

  it.effect("fails competing concurrent redemptions closed after creating one device", () =>
    Effect.gen(function* () {
      const pairing = yield* Pairing.Service
      const invitation = yield* pairing.issue({ urls: ["https://shuvdev.example"] })
      const first = pairing.redeem({
        token: invitation.token,
        requestID: RequestID.make("de7bb697-5475-40d0-b56c-900bfcf64e30"),
        deviceName: DeviceName.make("First"),
        credential: DeviceCredential.make("scd_v1_FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"),
      })
      const second = pairing.redeem({
        token: invitation.token,
        requestID: RequestID.make("98089dad-ee55-49c7-831e-6e3c07238169"),
        deviceName: DeviceName.make("Second"),
        credential: DeviceCredential.make("scd_v1_GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG"),
      })

      const exits = yield* Effect.all([Effect.exit(first), Effect.exit(second)], { concurrency: 2 })
      expect(exits.filter(Exit.isSuccess)).toHaveLength(1)
      expect(exits.filter(Exit.isFailure)).toHaveLength(1)
      expect((yield* pairing.list()).filter((device) => ["First", "Second"].includes(device.name))).toHaveLength(1)
    }),
  )

  it.effect("detects request-only and credential-only uniqueness conflicts", () =>
    Effect.gen(function* () {
      const pairing = yield* Pairing.Service
      const first = yield* pairing.issue({ urls: ["https://shuvdev.example"] })
      const firstRequest = RequestID.make("7707d867-522d-42f5-8438-e2280d4822c4")
      const firstCredential = DeviceCredential.make("scd_v1_HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH")
      yield* pairing.redeem({
        token: first.token,
        requestID: firstRequest,
        deviceName: DeviceName.make("Original"),
        credential: firstCredential,
      })
      const second = yield* pairing.issue({ urls: ["https://shuvdev.example"] })
      expect(
        (yield* pairing
          .redeem({
            token: second.token,
            requestID: firstRequest,
            deviceName: DeviceName.make("Changed request"),
            credential: DeviceCredential.make("scd_v1_IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII"),
          })
          .pipe(Effect.flip))._tag,
      ).toBe("PairingConflict")
      expect(
        (yield* pairing
          .redeem({
            token: second.token,
            requestID: RequestID.make("12332213-820a-49f7-8901-23187b2f8ec1"),
            deviceName: DeviceName.make("Changed credential"),
            credential: firstCredential,
          })
          .pipe(Effect.flip))._tag,
      ).toBe("PairingConflict")
    }),
  )

  it.effect("stores only credential and invitation digests", () =>
    Effect.gen(function* () {
      const pairing = yield* Pairing.Service
      const invitation = yield* pairing.issue({ urls: ["https://shuvdev.example"] })
      const secret = DeviceCredential.make("scd_v1_JJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJ")
      const result = yield* pairing.redeem({
        token: invitation.token,
        requestID: RequestID.make("5724ec39-cb0b-4cd9-be63-ef51cc2f3468"),
        deviceName: DeviceName.make("Private"),
        credential: secret,
      })
      const row = yield* (yield* Database.Service).db
        .select()
        .from(PairingDeviceTable)
        .where(eq(PairingDeviceTable.id, result.deviceID))
        .get()

      expect(row?.credential_hash).toMatch(/^[a-f0-9]{64}$/)
      expect(row?.invitation_hash).toMatch(/^[a-f0-9]{64}$/)
      expect(JSON.stringify(row)).not.toContain(secret)
      expect(JSON.stringify(row)).not.toContain(invitation.token)
    }),
  )

  it.effect("retains the invitation when durable enrollment fails", () =>
    Effect.gen(function* () {
      const pairing = yield* Pairing.Service
      const database = yield* Database.Service
      const invitation = yield* pairing.issue({ urls: ["https://shuvdev.example"] })
      const input = {
        token: invitation.token,
        requestID: RequestID.make("2e7bb697-5475-40d0-b56c-900bfcf64e30"),
        deviceName: DeviceName.make("Retry Phone"),
        credential: DeviceCredential.make("scd_v1_NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN"),
      }

      yield* database.db.run(`
        CREATE TRIGGER pairing_device_fail_once
        BEFORE INSERT ON pairing_device
        BEGIN
          SELECT RAISE(ABORT, 'simulated enrollment failure');
        END;
      `)
      expect(Exit.isFailure(yield* Effect.exit(pairing.redeem(input)))).toBe(true)
      yield* database.db.run("DROP TRIGGER pairing_device_fail_once")

      expect(yield* pairing.redeem(input)).toEqual(expect.objectContaining({ deviceID: expect.any(String) }))
    }),
  )

  it.effect("invalidates outstanding invitations when the service restarts", () =>
    Effect.gen(function* () {
      const before = yield* Pairing.make()
      const invitation = yield* before.issue({ urls: ["https://shuvdev.example"] })
      const committed = yield* before.issue({ urls: ["https://shuvdev.example"] })
      const committedInput = {
        token: committed.token,
        requestID: RequestID.make("46a5de7e-716e-4c1e-8d37-685f79de3712"),
        deviceName: DeviceName.make("Committed"),
        credential: DeviceCredential.make("scd_v1_MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM"),
      }
      const committedDevice = yield* before.redeem(committedInput)
      const after = yield* Pairing.make()
      expect(yield* after.redeem(committedInput)).toEqual(committedDevice)
      const error = yield* after
        .redeem({
          token: invitation.token,
          requestID: RequestID.make("72fba88a-4921-418c-88c7-6a917509f77d"),
          deviceName: DeviceName.make("Restarted"),
          credential: DeviceCredential.make("scd_v1_KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK"),
        })
        .pipe(Effect.flip)
      expect(error._tag).toBe("PairingInvitationUnavailable")
    }),
  )

  it.live("rejects expired and malformed invitations and reports capacity", () =>
    Effect.gen(function* () {
      const pairing = yield* Pairing.make(Duration.millis(2), 1)
      const invitation = yield* pairing.issue({ urls: ["https://shuvdev.example"] })
      expect((yield* pairing.issue({ urls: ["https://shuvdev.example"] }).pipe(Effect.flip))._tag).toBe(
        "PairingCapacityExceeded",
      )
      yield* Effect.sleep(Duration.millis(5))
      expect(
        (yield* pairing
          .redeem({
            token: invitation.token,
            requestID: RequestID.make("901cc739-b2f7-4df7-aa66-898c9afb1c79"),
            deviceName: DeviceName.make("Expired"),
            credential: DeviceCredential.make("scd_v1_LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL"),
          })
          .pipe(Effect.flip))._tag,
      ).toBe("PairingInvitationUnavailable")
      expect(
        (yield* pairing
          .redeem({
            token: "malformed" as InvitationToken,
            requestID: RequestID.make("7b00ed9a-e7e8-4667-b88f-8d68ba93d050"),
            deviceName: DeviceName.make("Malformed"),
            credential: "bad" as DeviceCredential,
          })
          .pipe(Effect.flip))._tag,
      ).toBe("PairingInvalidRequest")
    }),
  )
})
