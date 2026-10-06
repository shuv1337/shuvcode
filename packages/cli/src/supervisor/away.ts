import { Schema } from "effect"
import { DatabaseSync } from "node:sqlite"
import { createHash } from "node:crypto"

export namespace SupervisorAway {
  const Text = Schema.String.check(Schema.isMaxLength(64_000))
  const ID = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/))
  export const Clause = Schema.Struct({
    action: Schema.optional(Text),
    object: Schema.optional(Text),
    when: Schema.optional(Text),
    stop: Schema.optional(Text),
  })
  export const Classification = Schema.Struct({
    blockerID: Text.check(Schema.isMinLength(1)),
    expectedReason: Text.check(Schema.isMinLength(1)),
    kind: Schema.Literals(["external-wait", "user-decision"]),
    reason: Text.check(Schema.isMinLength(1)),
    reference: Text.check(Schema.isMinLength(1)),
  })
  export type Classification = typeof Classification.Type
  export const Operation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("away.blocker.reclassify"), ...Classification.fields }),
    Schema.Struct({ type: Schema.Literal("away.get") }),
    Schema.Struct({
      type: Schema.Literal("away.propose"),
      id: ID,
      words: Text,
      clauses: Schema.Array(Clause),
      expectedReturn: Schema.optional(Text),
      spend: Schema.optional(Text),
    }),
    Schema.Struct({ type: Schema.Literal("away.confirm"), proposalID: ID }),
    Schema.Struct({ type: Schema.Literal("away.return.begin") }),
    Schema.Struct({ type: Schema.Literal("away.return.check") }),
    Schema.Struct({ type: Schema.Literal("away.input"), sessionID: Text, messageID: Text, text: Text }),
  ])
  export type Operation = typeof Operation.Type
  export type ReturnEvidence = {
    health: string[]
    blockers: { id: string; reason: string }[]
    waiting: string[]
    failed: string[]
    handled: string[]
    cost: string[]
  }
  export type Contract = {
    id: string
    revision: number
    requestHash: string
    words: string
    clauses: { action: string; object: string; when: string; stop?: string }[]
    refused: { ordinal: number; reason: string }[]
    flags: string[]
    expectedReturn?: string
    spend?: string
    enteredAt: number
    recordedAt: number
    readback: string
  }
  type Catchup = {
    superseded: Contract[]
    observations: ReturnEvidence[]
    contract: Contract
    startedAt: number
    brief: string
    evidence: ReturnEvidence
    complete: boolean
  }
  type State = { revision: number; contract?: Contract; proposal?: Contract; catchup?: Catchup }
  const actions = new Set([
    "merge",
    "land",
    "prerelease",
    "install",
    "rerun",
    "dispatch",
    "abort-run",
    "answer",
    "discard",
    "wake-me",
  ])

  /** Pure durable admission boundary: callbacks must not call the native server. */
  export function open(
    db: DatabaseSync,
    options: {
      isLead(sessionID: string): boolean
      isInternal(messageID: string): boolean
      snapshot(startedAt?: number): ReturnEvidence
      validateClassification?(classification: Classification): boolean
    },
  ) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS supervisor_away_classification (revision INTEGER NOT NULL, blocker_id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (revision, blocker_id));
      CREATE TABLE IF NOT EXISTS supervisor_away_observation (entered_at INTEGER NOT NULL, digest TEXT NOT NULL, value TEXT NOT NULL, observed_at INTEGER NOT NULL, PRIMARY KEY (entered_at, digest));
      CREATE TABLE IF NOT EXISTS supervisor_away_state (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS supervisor_away_proposal (id TEXT PRIMARY KEY, request_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS supervisor_away_archive (revision INTEGER PRIMARY KEY, contract TEXT NOT NULL, reason TEXT NOT NULL, archived_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS supervisor_away_input (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, message_id TEXT NOT NULL UNIQUE, text TEXT NOT NULL, replacement TEXT NOT NULL, acknowledged INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    `)
    function state(): State {
      const row = db.prepare("SELECT value FROM supervisor_away_state WHERE id = 1").get() as
        | { value: string }
        | undefined
      return row ? JSON.parse(row.value) : { revision: 0 }
    }
    function save(value: State) {
      db.prepare(
        "INSERT INTO supervisor_away_state (id, value) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value",
      ).run(JSON.stringify(value))
    }
    function transaction<T>(run: () => T): T {
      if (db.isTransaction) return run()
      db.exec("BEGIN IMMEDIATE")
      try {
        const value = run()
        db.exec("COMMIT")
        return value
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
    }
    function archive(contract: Contract, reason: string) {
      db.prepare(
        "INSERT OR IGNORE INTO supervisor_away_archive (revision, contract, reason, archived_at) VALUES (?, ?, ?, ?)",
      ).run(contract.revision, JSON.stringify(contract), reason, Date.now())
    }
    function observations(contract: Contract) {
      return (
        db
          .prepare("SELECT value FROM supervisor_away_observation WHERE entered_at = ? ORDER BY observed_at, digest")
          .all(contract.enteredAt) as { value: string }[]
      ).map((row) => JSON.parse(row.value) as ReturnEvidence)
    }
    function recordEvidence(evidence: ReturnEvidence) {
      const value = state()
      const contract = value.contract ?? (value.catchup?.complete ? undefined : value.catchup?.contract)
      if (!contract) return
      const encoded = JSON.stringify(evidence)
      db.prepare(
        "INSERT OR IGNORE INTO supervisor_away_observation (entered_at, digest, value, observed_at) VALUES (?, ?, ?, ?)",
      ).run(contract.enteredAt, createHash("sha256").update(encoded).digest("hex"), encoded, Date.now())
    }
    function reopened() {
      return transaction(() => {
        const value = state()
        if (!value.contract && (!value.catchup || value.catchup.complete)) return get()
        recordEvidence({
          health: [
            "GAP: supervisor restarted during the away period or return catch-up; uninterrupted coverage is unverified. Downtime duration was not measured.",
          ],
          blockers: [],
          waiting: [],
          failed: [],
          handled: [],
          cost: [],
        })
        if (value.catchup && !value.catchup.complete) {
          const retained = observations(value.catchup.contract)
          save({
            ...value,
            catchup: {
              ...value.catchup,
              observations: retained,
              brief: brief(value.catchup.contract, value.catchup.evidence, value.catchup.superseded, retained),
            },
          })
        }
        return get()
      })
    }
    function classifications(revision: number) {
      return (
        db.prepare("SELECT value FROM supervisor_away_classification WHERE revision = ?").all(revision) as {
          value: string
        }[]
      ).map((row) => JSON.parse(row.value) as Classification)
    }
    function currentEvidence(revision: number, startedAt: number) {
      const evidence = options.snapshot(startedAt)
      const classified = classifications(revision).filter(
        (item) =>
          evidence.blockers.some(
            (blocker) => blocker.id === item.blockerID && blocker.reason === item.expectedReason,
          ) &&
          (item.kind !== "user-decision" || options.validateClassification?.(item) === true),
      )
      return {
        ...evidence,
        blockers: evidence.blockers.filter((blocker) => !classified.some((item) => item.blockerID === blocker.id)),
        waiting: [
          ...evidence.waiting,
          ...classified.map(
            (item) =>
              `${item.kind}: ${item.blockerID} — ${item.reason} (reference: ${item.reference}; original blocker retained: ${item.expectedReason})`,
          ),
        ],
      }
    }
    function get() {
      const value = state()
      return {
        ...value,
        classifications: classifications(value.revision),
        enabled: !!value.contract,
        pendingCatchup: !!value.catchup && !value.catchup.complete,
      }
    }
    function begin() {
      return transaction(() => {
        const value = state()
        if (!value.contract) return get()
        const evidence = options.snapshot(value.contract.enteredAt)
        const superseded = (
          db
            .prepare(
              "SELECT contract FROM supervisor_away_archive WHERE reason = 'superseded' AND json_extract(contract, '$.enteredAt') = ? ORDER BY revision",
            )
            .all(value.contract.enteredAt) as { contract: string }[]
        ).map((row) => JSON.parse(row.contract) as Contract)
        const catchup = {
          superseded,
          observations: observations(value.contract),
          contract: value.contract,
          startedAt: Date.now(),
          brief: brief(value.contract, evidence, superseded, observations(value.contract)),
          evidence,
          complete: false,
        }
        // Catch-up, archive, and posture move together; a crash cannot lose the return obligation.
        archive(value.contract, "returned")
        save({ revision: value.revision, catchup })
        return get()
      })
    }
    function admit(input: { sessionID: string; messageID: string; text: string }) {
      if (
        !options.isLead(input.sessionID) ||
        options.isInternal(input.messageID) ||
        /^\s*\/afk(?:\s|$)/i.test(input.text)
      )
        return { text: input.text, deferred: false }
      return transaction(() => {
        const prior = db
          .prepare("SELECT session_id, replacement FROM supervisor_away_input WHERE message_id = ?")
          .get(input.messageID) as { session_id: string; replacement: string } | undefined
        if (prior) {
          if (prior.session_id !== input.sessionID) throw new Error("Away input ID belongs to another session")
          return { text: prior.replacement, deferred: true }
        }
        const value = begin()
        if (!value.pendingCatchup) return { text: input.text, deferred: false }
        const replacement = `${value.catchup!.brief}\n\nThe user's new request is durably deferred until catch-up completes. Resolve or explicitly reclassify lead-actionable blockers, then call away.return.check. Do not act on deferred requests yet.`
        db.prepare(
          "INSERT INTO supervisor_away_input (id, session_id, message_id, text, replacement, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(
          `msg_away_${createHash("sha256").update(input.sessionID).update("\0").update(input.messageID).digest("hex").slice(0, 40)}`,
          input.sessionID,
          input.messageID,
          input.text,
          replacement,
          Date.now(),
        )
        return { text: replacement, deferred: true }
      })
    }
    function request(actor: { operator: true } | { sessionID: string }, operation: Operation) {
      if (operation.type === "away.input") {
        if (!("operator" in actor) && actor.sessionID !== operation.sessionID)
          throw new Error("Away input session does not match its caller")
        return admit(operation)
      }
      if (!("operator" in actor) && !options.isLead(actor.sessionID))
        throw new Error("Away posture requires the active lead or local operator")
      if (operation.type === "away.get") return get()
      if (operation.type === "away.return.begin") return begin()
      if (operation.type === "away.blocker.reclassify")
        return transaction(() => {
          const value = state()
          if (!value.catchup || value.catchup.complete) throw new Error("A pending return catch-up is required")
          if (!operation.reason.trim() || !operation.reference.trim())
            throw new Error("Reclassification requires an explicit reason and supporting reference")
          if (
            !options
              .snapshot(value.catchup.contract.enteredAt)
              .blockers.some(
                (blocker) => blocker.id === operation.blockerID && blocker.reason === operation.expectedReason,
              )
          )
            throw new Error("Blocker changed or no longer exists; refresh catch-up evidence")
          if (operation.kind === "user-decision" && options.validateClassification?.(operation) !== true)
            throw new Error("Reference does not identify a current waiting user decision")
          if (
            operation.kind === "external-wait" &&
            options.validateClassification &&
            !options.validateClassification(operation)
          )
            throw new Error("External-wait reference is not valid")
          db.prepare(
            "INSERT INTO supervisor_away_classification (revision, blocker_id, value) VALUES (?, ?, ?) ON CONFLICT(revision, blocker_id) DO UPDATE SET value = excluded.value",
          ).run(value.revision, operation.blockerID, JSON.stringify(operation))
          return get()
        })
      if (operation.type === "away.return.check")
        return transaction(() => {
          const value = state()
          if (value.contract) throw new Error("Begin the return catch-up first")
          if (!value.catchup || value.catchup.complete) return get()
          const evidence = currentEvidence(value.revision, value.catchup.contract.enteredAt)
          save({
            ...value,
            catchup: {
              ...value.catchup,
              evidence,
              brief: brief(
                value.catchup.contract,
                evidence,
                value.catchup.superseded,
                observations(value.catchup.contract),
              ),
              observations: observations(value.catchup.contract),
              complete: evidence.blockers.length === 0,
            },
          })
          return get()
        })
      if (operation.type === "away.propose")
        return transaction(() => {
          const value = state()
          if (value.catchup && !value.catchup.complete)
            throw new Error("Complete return catch-up before entering away mode")
          const requestHash = createHash("sha256").update(JSON.stringify(operation)).digest("hex")
          if (value.proposal?.id === operation.id) {
            if (value.proposal.requestHash !== requestHash) throw new Error("Away proposal ID has already been used")
            return value.proposal
          }
          if (
            value.contract?.id === operation.id ||
            db
              .prepare("SELECT 1 FROM supervisor_away_archive WHERE json_extract(contract, '$.id') = ?")
              .get(operation.id)
          )
            throw new Error("Away proposal ID has already been confirmed")
          if (db.prepare("SELECT 1 FROM supervisor_away_proposal WHERE id = ?").get(operation.id))
            throw new Error("Away proposal ID has already been superseded")
          const refused = operation.clauses.flatMap((clause, index) => {
            const missing = ["action", "object", "when"].filter(
              (field) => !clause[field as "action" | "object" | "when"]?.trim(),
            )
            if (missing.length) return [{ ordinal: index + 1, reason: `Missing ${missing.join(", ")}` }]
            if (!actions.has(clause.action!))
              return [{ ordinal: index + 1, reason: `Unknown action: ${clause.action}` }]
            return []
          })
          const clauses = operation.clauses.flatMap((clause, index) =>
            refused.some((item) => item.ordinal === index + 1)
              ? []
              : [
                  {
                    action: clause.action!,
                    object: clause.object!,
                    when: clause.when!,
                    ...(clause.stop ? { stop: clause.stop } : {}),
                  },
                ],
          )
          const contract: Contract = {
            id: operation.id,
            revision: value.revision + 1,
            requestHash,
            words: operation.words,
            clauses,
            refused,
            flags: [
              "Clauses are recorded only; they grant no execution authority.",
              "Destructive, security-sensitive, and user-owned decisions remain held for return.",
              "Spend guidance is recorded only and imposes no concurrency cap; expected return is advisory.",
            ],
            expectedReturn: operation.expectedReturn,
            spend: operation.spend,
            enteredAt: value.contract?.enteredAt ?? Date.now(),
            recordedAt: Date.now(),
            readback: "",
          }
          if (value.contract && !operation.words.trim() && operation.clauses.length === 0) {
            contract.words = value.contract.words
            contract.clauses = value.contract.clauses
            contract.refused = value.contract.refused
            contract.expectedReturn = operation.expectedReturn ?? value.contract.expectedReturn
            contract.spend = operation.spend ?? value.contract.spend
          }
          contract.readback = readback(contract)
          db.prepare("INSERT INTO supervisor_away_proposal (id, request_hash) VALUES (?, ?)").run(
            contract.id,
            requestHash,
          )
          save({ ...value, proposal: contract })
          return contract
        })
      if (!("operator" in actor)) throw new Error("Away readback confirmation requires the local operator")
      return transaction(() => {
        const value = state()
        if (value.contract?.id === operation.proposalID) return get()
        if (
          !value.proposal ||
          value.proposal.id !== operation.proposalID ||
          value.proposal.revision !== value.revision + 1
        )
          throw new Error("Away proposal is missing or superseded; confirm its current readback")
        if (value.contract) archive(value.contract, "superseded")
        save({ revision: value.proposal.revision, contract: value.proposal })
        return get()
      })
    }
    if (!db.prepare("SELECT 1 FROM supervisor_away_state WHERE id = 1").get()) {
      const legacy = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'supervisor_channel_away'")
        .get()
        ? (db.prepare("SELECT enabled, until_at, note, updated_at FROM supervisor_channel_away WHERE id = 1").get() as
            | { enabled: number; until_at: number | null; note: string | null; updated_at: number }
            | undefined)
        : undefined
      if (!legacy?.enabled) save({ revision: 0 })
      if (legacy?.enabled) {
        const contract: Contract = {
          id: "legacy-away",
          revision: 1,
          requestHash: "legacy",
          words: legacy.note ?? "",
          clauses: [],
          refused: [],
          flags: [
            "Imported legacy away posture; no structured contract or prior readback confirmation is asserted.",
            "Recorded only; no additional execution authority.",
          ],
          expectedReturn: legacy.until_at === null ? undefined : new Date(legacy.until_at).toISOString(),
          enteredAt: legacy.updated_at,
          recordedAt: Date.now(),
          readback: "",
        }
        contract.readback = readback(contract)
        save({ revision: 1, contract })
      }
    }
    return {
      reopened,
      recordEvidence,
      request,
      admit,
      get,
      pendingInputs() {
        if (get().pendingCatchup) return []
        return db
          .prepare(
            "SELECT id, session_id AS sessionID, text FROM supervisor_away_input WHERE acknowledged = 0 ORDER BY created_at, id",
          )
          .all() as { id: string; sessionID: string; text: string }[]
      },
      ackInput(id: string) {
        db.prepare("UPDATE supervisor_away_input SET acknowledged = 1 WHERE id = ?").run(id)
      },
      guard() {
        if (get().pendingCatchup) throw new Error("Complete return catch-up before starting new ordinary work")
      },
    }
  }

  function readback(contract: Contract) {
    return [
      `Away proposal ${contract.id} (revision ${contract.revision})`,
      `Exact words: ${contract.words || "(no additional instructions)"}`,
      "Recorded clauses:",
      ...contract.clauses.map(
        (clause, index) =>
          `${index + 1}. ${clause.action} ${clause.object}; when: ${clause.when}${clause.stop ? `; stop: ${clause.stop}` : ""}`,
      ),
      ...contract.refused.map((clause) => `Refused clause ${clause.ordinal}: ${clause.reason}`),
      ...contract.flags,
      `Expected return (advisory): ${contract.expectedReturn ?? "unspecified"}`,
      `Spend guidance (advisory): ${contract.spend ?? "unchanged"}`,
      "Hold for return: user-owned decisions and anything outside existing authority. Confirmation records this contract only.",
    ].join("\n")
  }
  function brief(contract: Contract, evidence: ReturnEvidence, superseded: Contract[], observations: ReturnEvidence[]) {
    return [
      "Return catch-up must complete before new work.",
      "Health and gaps:",
      ...Array.from(new Set(observations.flatMap((item) => item.health.filter((line) => line.startsWith("GAP:"))))),
      ...evidence.health,
      ...evidence.blockers.map((blocker) => `Lead-actionable blocker ${blocker.id}: ${blocker.reason}`),
      "Earlier observations while away (historical; current blockers are listed above):",
      ...Array.from(
        new Set(
          observations.flatMap((item) => [
            ...item.health.filter((line) => !line.startsWith("GAP:")),
            ...item.failed,
            ...item.blockers.map((blocker) => `${blocker.id}: ${blocker.reason}`),
          ]),
        ),
      ),
      "Away contract (recorded only; archived on return):",
      contract.readback,
      ...superseded.map((prior) => `Superseded contract (recorded only):\n${prior.readback}`),
      "Waiting on the user (does not block catch-up):",
      ...evidence.waiting,
      "Failed or unfixed:",
      ...evidence.failed,
      "Handled while away:",
      ...Array.from(new Set([...evidence.handled, ...observations.flatMap((item) => item.handled)])),
      "Cost and usage evidence:",
      ...evidence.cost,
    ].join("\n")
  }
}
