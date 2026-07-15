import { expect } from "bun:test"
import { Effect } from "effect"
import { it } from "../../core/test/lib/effect"
import { Status } from "../src/service-status"

it.effect("moves from starting to ready", () =>
  Effect.gen(function* () {
    const status = yield* Status.make({ instanceID: "one", managed: false })
    expect(yield* status.current).toEqual({ type: "starting" })
    yield* status.ready
    expect(yield* status.current).toEqual({ type: "ready" })
  }),
)

it.effect("keeps a startup failure until shutdown", () =>
  Effect.gen(function* () {
    const status = yield* Status.make({ instanceID: "one", managed: true })
    yield* status.fail
    yield* status.ready
    yield* status.fail
    expect(yield* status.current).toEqual({ type: "failed" })
  }),
)

it.effect("stops only the addressed managed instance", () =>
  Effect.gen(function* () {
    const status = yield* Status.make({ instanceID: "one", managed: true })

    expect(yield* status.requestStop({ instanceID: "other" })).toBe(false)
    expect(yield* status.current).toEqual({ type: "starting" })
    expect(yield* status.requestStop({ instanceID: "one" })).toBe(true)
    expect(yield* status.current).toEqual({ type: "stopping" })
  }),
)

it.effect("keeps stopping after shutdown begins", () =>
  Effect.gen(function* () {
    const status = yield* Status.make({ instanceID: "one", managed: true })

    yield* status.beginStopping
    expect(yield* status.current).toEqual({ type: "stopping" })
    expect(yield* status.requestStop({ instanceID: "one" })).toBe(true)
    expect(yield* status.current).toEqual({ type: "stopping" })
  }),
)
