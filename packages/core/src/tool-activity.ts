export * as ToolActivity from "./tool-activity.js"

import { Context, Effect, Layer, Scope } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Session } from "@opencode/schema/session"

export interface Change {
  readonly sessionID: Session.ID
  readonly count: number
}

export interface Interface {
  /** Sessions that currently hold at least one in-flight tool lease. */
  readonly holding: Effect.Effect<ReadonlySet<Session.ID>>
  readonly count: (sessionID: Session.ID) => Effect.Effect<number>
  /**
   * One in-flight tool call. The release runs when the surrounding scope closes,
   * including success, failure, interruption, and defect.
   */
  readonly lease: (sessionID: Session.ID) => Effect.Effect<void, never, Scope.Scope>
  readonly listen: (listener: (event: Change) => Effect.Effect<void>) => Effect.Effect<Effect.Effect<void>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ToolActivity") {}

type Listener = (event: Change) => Effect.Effect<void>

export const layer = Layer.effect(
  Service,
  Effect.sync(() => {
    const counts = new Map<Session.ID, number>()
    const listeners = new Set<Listener>()
    const change = (sessionID: Session.ID, delta: 1 | -1) => {
      const count = (counts.get(sessionID) ?? 0) + delta
      if (count <= 0) counts.delete(sessionID)
      else counts.set(sessionID, count)
      return Math.max(count, 0)
    }
    const emit = (event: Change) =>
      Effect.forEach(Array.from(listeners), (listener) => listener(event), { discard: true })

    return Service.of({
      holding: Effect.sync(() => new Set(counts.keys())),
      count: (sessionID) => Effect.sync(() => counts.get(sessionID) ?? 0),
      lease: (sessionID) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            change(sessionID, 1)
          }),
          () =>
            Effect.sync(() => change(sessionID, -1)).pipe(
              Effect.flatMap((count) => emit({ sessionID, count })),
            ),
        ),
      listen: (listener) =>
        Effect.sync(() => {
          listeners.add(listener)
          return Effect.sync(() => {
            listeners.delete(listener)
          })
        }),
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [],
})
