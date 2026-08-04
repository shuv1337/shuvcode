import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Credential } from "@opencode-ai/core/credential"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Integration } from "@opencode-ai/core/integration"
import { testEffect } from "./lib/effect"
import { Database } from "@opencode-ai/core/database/database"
import { sql } from "drizzle-orm"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Credential.node, Database.node])))

describe("Credential", () => {
  it.effect("reports no configured authentication without exposing secrets", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      expect(yield* credentials.status()).toEqual({ storage: "available", profiles: [] })
    }),
  )

  it.effect("reports locally usable, expired, and malformed stored profiles", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const database = yield* Database.Service
      const keyProvider = Integration.ID.make("key-provider")
      const oauthProvider = Integration.ID.make("oauth-provider")
      const malformedProvider = Integration.ID.make("malformed-provider")
      const malformedID = Credential.ID.make("cred_malformed")
      const key = yield* credentials.create({
        integrationID: keyProvider,
        value: Credential.Key.make({ type: "key", key: "stored-secret" }),
      })
      const oauth = yield* credentials.create({
        integrationID: oauthProvider,
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("oauth"),
          access: "access-secret",
          refresh: "refresh-secret",
          expires: 1,
        }),
      })
      yield* database.db.run(
        sql`INSERT INTO credential (id, integration_id, label, value, time_created, time_updated) VALUES (${malformedID}, ${malformedProvider}, 'default', ${JSON.stringify({ type: "unknown", secret: "hidden-secret" })}, 1, 1)`,
      )

      const status = yield* credentials.status()
      expect(status).toEqual({
        storage: "available",
        profiles: [
          {
            providerID: malformedProvider,
            profileID: malformedID,
            source: "stored",
            type: "unknown",
            usable: false,
            reason: "malformed",
          },
          {
            providerID: keyProvider,
            profileID: key.id,
            source: "stored",
            type: "key",
            usable: true,
            reason: "configured",
          },
          {
            providerID: oauthProvider,
            profileID: oauth.id,
            source: "stored",
            type: "oauth",
            usable: false,
            reason: "expired",
          },
        ],
      })
      const serialized = JSON.stringify(status)
      for (const secret of ["stored-secret", "access-secret", "refresh-secret", "hidden-secret"]) {
        expect(serialized).not.toContain(secret)
      }
    }),
  )

  it.effect("redacts corrupted credential storage failures", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const database = yield* Database.Service
      const corruptID = Credential.ID.make("cred_corrupt")
      yield* database.db.run(
        sql`INSERT INTO credential (id, integration_id, label, value, time_created, time_updated) VALUES (${corruptID}, 'broken', 'default', '{', 1, 1)`,
      )

      expect(yield* credentials.status()).toEqual({ storage: "unavailable", profiles: [] })
    }),
  )

  it.effect("stores, updates, lists, and removes credentials", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("openai")
      const created = yield* credentials.create({
        integrationID,
        label: "Work",
        value: Credential.Key.make({ type: "key", key: "secret" }),
      })

      expect(yield* credentials.list(integrationID)).toEqual([created])
      yield* credentials.update(created.id, { label: "Personal" })
      expect((yield* credentials.list(integrationID))[0]?.label).toBe("Personal")

      const replacement = yield* credentials.create({
        integrationID,
        label: "Replacement",
        value: Credential.Key.make({ type: "key", key: "replacement" }),
      })
      expect(yield* credentials.list(integrationID)).toEqual([replacement])

      yield* credentials.remove(replacement.id)
      expect(yield* credentials.list(integrationID)).toEqual([])
    }),
  )
})
