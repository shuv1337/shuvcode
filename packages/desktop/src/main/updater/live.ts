export * as UpdaterLive from "./live"

import { Effect, Layer } from "effect"
import { DesktopInitialization } from "../lifecycle/desktop-initialization"
import { ApplicationLifecycle } from "../lifecycle"
import { make, Service } from "./index"

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const lifecycle = yield* ApplicationLifecycle.Service
    const desktop = yield* DesktopInitialization.Service
    return yield* make({
      currentVersion: desktop.version,
      prepareToRestart: lifecycle.prepareToRestart,
      persistence: {
        get: Effect.succeed(undefined),
        set: () => Effect.void,
        clear: Effect.void,
      },
    })
  }),
)
