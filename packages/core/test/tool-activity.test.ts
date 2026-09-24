import { describe, expect } from "bun:test"
import { ToolActivity } from "@opencode/core/tool-activity"
import { execute } from "@opencode/core/tool/runtime"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Tool } from "@opencode/schema/tool"
import { Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.fresh(ToolActivity.layer))

const context = {
  sessionID: Session.ID.make("ses_lease"),
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_lease"),
  id: Tool.CallID.make("call_lease"),
  progress: () => Effect.void,
}

const other = {
  ...context,
  sessionID: Session.ID.make("ses_other"),
}

const hold = (started: Deferred.Deferred<void>, release: Deferred.Deferred<void>): Tool.Info => ({
  name: "hold",
  description: "Hold",
  input: {},
  execute: () =>
    Effect.gen(function* () {
      yield* Deferred.succeed(started, undefined)
      yield* Deferred.await(release)
      return { content: "ok" }
    }),
})

describe("ToolActivity leases", () => {
  it.effect("counts overlapping leases per session and releases each one", () =>
    Effect.gen(function* () {
      const activity = yield* ToolActivity.Service
      const firstStarted = yield* Deferred.make<void>()
      const secondStarted = yield* Deferred.make<void>()
      const firstRelease = yield* Deferred.make<void>()
      const secondRelease = yield* Deferred.make<void>()
      const otherStarted = yield* Deferred.make<void>()
      const otherRelease = yield* Deferred.make<void>()

      const first = yield* execute(hold(firstStarted, firstRelease), {}, context).pipe(Effect.forkScoped)
      const second = yield* execute(hold(secondStarted, secondRelease), {}, context).pipe(Effect.forkScoped)
      const unrelated = yield* execute(hold(otherStarted, otherRelease), {}, other).pipe(Effect.forkScoped)
      yield* Deferred.await(firstStarted)
      yield* Deferred.await(secondStarted)
      yield* Deferred.await(otherStarted)
      expect(yield* activity.count(context.sessionID)).toBe(2)
      expect(yield* activity.count(other.sessionID)).toBe(1)
      expect(Array.from(yield* activity.holding).toSorted()).toEqual([context.sessionID, other.sessionID].toSorted())

      yield* Deferred.succeed(firstRelease, undefined)
      yield* Fiber.join(first)
      expect(yield* activity.count(context.sessionID)).toBe(1)
      expect(yield* activity.count(other.sessionID)).toBe(1)

      yield* Deferred.succeed(secondRelease, undefined)
      yield* Fiber.join(second)
      expect(yield* activity.count(context.sessionID)).toBe(0)
      expect(Array.from(yield* activity.holding)).toEqual([other.sessionID])

      yield* Deferred.succeed(otherRelease, undefined)
      yield* Fiber.join(unrelated)
      expect(yield* activity.holding).toEqual(new Set())
    }),
  )

  it.effect("releases a lease after success, failure, interruption, and defect", () =>
    Effect.gen(function* () {
      const activity = yield* ToolActivity.Service
      const succeeded = yield* execute(
        {
          name: "ok",
          description: "Ok",
          input: {},
          execute: () => Effect.succeed({ content: "ok" }),
        },
        {},
        context,
      )
      expect(succeeded.content).toEqual([{ type: "text", text: "ok" }])
      expect(yield* activity.count(context.sessionID)).toBe(0)

      const failed = yield* execute(
        {
          name: "fail",
          description: "Fail",
          input: {},
          execute: () => new Tool.Error({ message: "nope" }),
        },
        {},
        context,
      ).pipe(Effect.flip)
      expect(failed).toBeInstanceOf(Tool.Error)
      expect(failed.message).toBe("nope")
      expect(yield* activity.count(context.sessionID)).toBe(0)

      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const fiber = yield* execute(hold(started, release), {}, context).pipe(Effect.forkScoped)
      yield* Deferred.await(started)
      expect(yield* activity.count(context.sessionID)).toBe(1)
      yield* Fiber.interrupt(fiber)
      expect(yield* activity.count(context.sessionID)).toBe(0)

      const died = yield* execute(
        {
          name: "die",
          description: "Die",
          input: {},
          execute: () => Effect.die("tool defect"),
        },
        {},
        context,
      ).pipe(Effect.exit)
      expect(Exit.isFailure(died)).toBe(true)
      expect(yield* activity.count(context.sessionID)).toBe(0)
      expect(yield* activity.holding).toEqual(new Set())
    }),
  )
})
