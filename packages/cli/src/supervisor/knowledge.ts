import path from "node:path"
import { Schema } from "effect"
import { SupervisorDelegates } from "./delegates"
import type { SupervisorProtocol } from "./protocol"
import type { SupervisorStore } from "./store"

export namespace SupervisorKnowledge {
  const ID = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/))
  const Text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256_000))
  const Scope = Schema.Literals(["preferences", "shared", "fleet", "project", "task"])
  const Tier = Schema.Literals(["pinned", "aging", "perishable"])
  const Record = Schema.Struct({
    id: ID,
    scope: Scope,
    scopeID: Schema.optional(ID),
    title: Text,
    content: Text,
    tier: Tier,
    evidence: Schema.optional(Text),
    reinforcedAt: Schema.Number,
    expiresAt: Schema.optional(Schema.Number),
    expiryCondition: Schema.optional(Text),
    sourceHome: Schema.optional(Schema.String),
    sourceID: Schema.optional(Schema.String),
    sourceVersion: Schema.optional(Schema.Number),
    createdAt: Schema.Number,
    updatedAt: Schema.Number,
  })
  const Budget = Schema.Struct({
    state: Schema.Literals(["ready", "blocked"]),
    estimatedTokens: Schema.Int,
    budgetTokens: Schema.Int,
  })
  const StowResult = Schema.Struct({ after: Budget })
  const SyncResult = Schema.Struct({ startup: Budget })
  export const Change = Schema.Union([
    Schema.Struct({
      action: Schema.Literal("upsert"),
      id: ID,
      scope: Scope,
      scopeID: Schema.optional(ID),
      title: Text,
      content: Text,
      tier: Schema.optional(Tier),
      evidence: Text,
      expiresAt: Schema.optional(Schema.Number),
      expiryCondition: Schema.optional(Text),
    }),
    Schema.Struct({ action: Schema.Literal("reinforce"), id: ID, evidence: Text }),
    Schema.Struct({ action: Schema.Literal("archive"), id: ID, evidence: Text, reason: Text }),
  ])
  export const Operation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("knowledge.startup") }),
    Schema.Struct({ type: Schema.Literal("knowledge.budget.set"), budgetTokens: Schema.Int }),
    Schema.Struct({
      type: Schema.Literal("knowledge.stow"),
      changes: Schema.Array(Change),
      cascade: Schema.optional(Schema.Boolean),
    }),
    Schema.Struct({ type: Schema.Literal("knowledge.archive.list"), id: Schema.optional(ID) }),
    Schema.Struct({ type: Schema.Literal("knowledge.shared.snapshot") }),
    Schema.Struct({ type: Schema.Literal("knowledge.shared.status") }),
    Schema.Struct({
      type: Schema.Literal("knowledge.shared.sync"),
      sourceHome: Text,
      sourceID: Text,
      version: Schema.Int,
      records: Schema.Array(Record),
    }),
    Schema.Struct({ type: Schema.Literal("knowledge.cascade") }),
  ])
  export type Operation = typeof Operation.Type
  type Store = ReturnType<typeof SupervisorStore.open>
  type Actor = SupervisorProtocol.Actor
  type Request = (
    delegate: SupervisorDelegates.Delegate,
    operation: Extract<Operation, { type: "knowledge.shared.sync" | "knowledge.stow" }>,
  ) => Promise<SupervisorDelegates.TransportResult>

  export function open(input: { store: Store; home: string; requestDelegate?: Request }) {
    const home = path.resolve(input.home)
    const knowledge = input.store.channels.knowledge
    const requestDelegate =
      input.requestDelegate ??
      ((
        delegate: SupervisorDelegates.Delegate,
        operation: Extract<Operation, { type: "knowledge.shared.sync" | "knowledge.stow" }>,
      ) => SupervisorDelegates.request(delegate, operation))

    function isLead(actor: Actor) {
      const lead = input.store.lead()
      return "sessionID" in actor && lead?.active === true && lead.sessionID === actor.sessionID
    }

    function requireLead(actor: Actor) {
      if ("operator" in actor || isLead(actor)) return
      throw new Error("Only the active supervisor lead or operator may curate knowledge")
    }

    function startup(options?: { now?: number }) {
      const budgetTokens = knowledge.getBudget()
      const now = options?.now ?? Date.now()
      const shared = knowledge.sharedStatus()
      const scopes = [
        { scope: "preferences" as const, heading: "PRIVATE HOME PREFERENCES" },
        { scope: "shared" as const, heading: "PRIMARY SHARED PREFERENCES" },
        { scope: "fleet" as const, heading: "HOME FLEET LEARNINGS" },
      ].map(({ scope, heading }) => {
        const active = knowledge.list({ scope })
        const archived = knowledge.archived().filter((item) => item.scope === scope)
        return {
          scope,
          heading,
          state: active.length ? ("present" as const) : archived.length ? ("empty" as const) : ("absent" as const),
          active,
        }
      })
      const text = [
        "Supervisor startup knowledge (read once for this lead process; task and project notes are available on demand):",
        ...scopes.flatMap(({ heading, state, active }) => [
          `${heading}: ${state.toUpperCase()}`,
          ...active.map((item) => `- [${item.id}] ${item.title}: ${item.content}`),
        ]),
        shared.sourceHome
          ? `SHARED CACHE: source=${shared.sourceHome}; version=${shared.version}; syncedAt=${new Date(shared.syncedAt ?? 0).toISOString()}; stale=${now - (shared.syncedAt ?? 0) >= 24 * 60 * 60 * 1000}`
          : `SHARED CACHE: locally owned; version=${shared.version}`,
      ].join("\n")
      const estimatedTokens = Math.ceil(Buffer.byteLength(text, "utf8") / 4)
      return {
        state: estimatedTokens > budgetTokens ? ("blocked" as const) : ("ready" as const),
        text,
        estimatedTokens,
        budgetTokens,
        scopes: scopes.map(({ scope, state, active }) => ({ scope, state, count: active.length })),
        sharedCache: {
          ...shared,
          stale: Boolean(shared.sourceHome && now - (shared.syncedAt ?? 0) >= 24 * 60 * 60 * 1000),
        },
      }
    }

    function prompt(actor: Actor, options?: { now?: number }) {
      if (!isLead(actor) && !("operator" in actor))
        return {
          state: "ready" as const,
          text: "",
          estimatedTokens: 0,
          budgetTokens: knowledge.getBudget(),
          scopes: [],
          sharedCache: knowledge.sharedStatus(),
        }
      return startup(options)
    }

    function guard() {
      const current = startup()
      if (current.state === "blocked")
        throw new Error(
          `Supervisor startup knowledge exceeds its operator-set ${current.budgetTokens}-token budget (${current.estimatedTokens} estimated tokens); curate or archive knowledge, or have the operator set a new budget`,
        )
      return current
    }

    function snapshot() {
      const status = knowledge.sharedStatus()
      if (status.sourceHome) throw new Error("A delegate cannot publish another primary's shared preferences")
      return {
        sourceHome: home,
        sourceID: knowledge.homeID(),
        version: status.version,
        records: knowledge.list({ scope: "shared", ownedOnly: true }),
      }
    }

    async function cascade() {
      const source = snapshot()
      const delegates = input.store.delegates.list()
      const results = await Promise.all(
        delegates.map(async (delegate) => {
          const shared = await sync(delegate)
          if (shared.state !== "ok")
            return {
              id: delegate.id,
              home: delegate.home,
              state: shared.state,
              phase: "shared-sync",
              error: shared.error,
            }
          const local = await bounded(delegate, { type: "knowledge.stow", changes: [], cascade: false })
          if (local.state !== "ok")
            return {
              id: delegate.id,
              home: delegate.home,
              state: local.state,
              phase: "local-stow",
              error: local.error,
              shared: shared.result,
            }
          if (!Schema.is(StowResult)(local.result))
            return {
              id: delegate.id,
              home: delegate.home,
              state: "unknown" as const,
              phase: "local-stow",
              error: "Delegate returned no stow budget result",
            }
          if (local.result.after.state === "blocked")
            return {
              id: delegate.id,
              home: delegate.home,
              state: "error" as const,
              phase: "local-stow",
              local: local.result,
              shared: shared.result,
              error: `Delegate startup knowledge exceeds ${local.result.after.budgetTokens} estimated tokens (${local.result.after.estimatedTokens})`,
            }
          return {
            id: delegate.id,
            home: delegate.home,
            state: local.state,
            phase: "local-stow",
            local: local.result,
            shared: shared.result,
          }
        }),
      )
      return {
        sourceHome: source.sourceHome,
        version: source.version,
        results,
        unresolved: results.filter((item) => item.state !== "ok"),
      }
    }

    async function sync(delegate: SupervisorDelegates.Delegate): Promise<SupervisorDelegates.TransportResult> {
      const current = startup()
      if (current.state === "blocked")
        return {
          state: "error",
          error: `Primary startup knowledge exceeds ${current.budgetTokens} estimated tokens (${current.estimatedTokens})`,
        }
      const result = await bounded(delegate, { type: "knowledge.shared.sync", ...snapshot() })
      if (result.state !== "ok") return result
      if (!Schema.is(SyncResult)(result.result))
        return { state: "unknown", error: "Delegate returned no shared startup budget result" }
      if (result.result.startup.state === "blocked")
        return {
          state: "error",
          error: `Delegate startup knowledge exceeds ${result.result.startup.budgetTokens} estimated tokens (${result.result.startup.estimatedTokens})`,
        }
      return result
    }

    async function bounded(delegate: SupervisorDelegates.Delegate, operation: Parameters<Request>[1]) {
      const timer: { id?: ReturnType<typeof setTimeout> } = {}
      const timeout = new Promise<SupervisorDelegates.TransportResult>((resolve) => {
        timer.id = setTimeout(
          () => resolve({ state: "unknown", error: "Knowledge request timed out after 15 seconds" }),
          15_000,
        )
      })
      try {
        return await Promise.race([requestDelegate(delegate, operation), timeout])
      } catch (error) {
        return { state: "unknown" as const, error: error instanceof Error ? error.message : String(error) }
      } finally {
        clearTimeout(timer.id)
      }
    }

    async function request(operation: Operation, actor: Actor): Promise<unknown> {
      const decoded = Schema.decodeUnknownSync(Operation)(operation)
      if (decoded.type === "knowledge.startup") return prompt(actor)
      if (decoded.type === "knowledge.budget.set") {
        if (!("operator" in actor)) throw new Error("Only the operator may change the startup knowledge budget")
        knowledge.setBudget(decoded.budgetTokens)
        return startup()
      }
      if (decoded.type === "knowledge.shared.sync") {
        if (!("operator" in actor)) throw new Error("Shared sync requires the destination operator route")
        return { cache: knowledge.syncShared({ ...decoded, records: [...decoded.records] }), startup: startup() }
      }
      requireLead(actor)
      if (decoded.type === "knowledge.shared.status") {
        const status = knowledge.sharedStatus()
        return {
          ...status,
          stale: Boolean(status.sourceHome && Date.now() - (status.syncedAt ?? 0) >= 24 * 60 * 60 * 1000),
        }
      }
      if (decoded.type === "knowledge.shared.snapshot") return snapshot()
      if (decoded.type === "knowledge.archive.list") return knowledge.archived({ id: decoded.id })
      if (decoded.type === "knowledge.cascade") return cascade()
      const delegate = Boolean(knowledge.sharedStatus().sourceID)
      if (decoded.cascade === false && !delegate)
        throw new Error("Primary stow must cascade; local-only stow is reserved for primary-bound delegates")
      const before = startup()
      const result = knowledge.stow(decoded.changes)
      const after = startup()
      const downstream = delegate ? undefined : await cascade()
      return { before, ...result, after, startupBlocked: after.state === "blocked", downstream }
    }

    return { request, startup, prompt, guard, cascade, snapshot, sync }
  }
}
