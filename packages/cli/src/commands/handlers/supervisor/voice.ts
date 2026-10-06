import path from "node:path"
import { Effect, Option } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { SupervisorClient } from "../../../supervisor/client"
import { SupervisorManaged } from "../../../supervisor/managed"
import { SupervisorSettings } from "../../../supervisor/settings"
import { SupervisorVoice } from "../../../supervisor/voice"

export default Runtime.handler(
  Commands.commands.supervisor.commands.voice,
  Effect.fn("cli.supervisor.voice")(function* (input) {
    const host = Option.getOrUndefined(input.host)
    const home =
      host && input.action === "talk"
        ? Option.getOrUndefined(input.home)
        : (yield* Effect.tryPromise(() => SupervisorSettings.read(Option.getOrUndefined(input.home)))).home
    if (!home || !path.isAbsolute(home)) return yield* Effect.fail(new Error("Voice requires an absolute --home"))
    if (input.action === "configure") {
      const result = yield* Effect.tryPromise(() =>
        SupervisorVoice.configure(home, {
          region: Option.getOrUndefined(input.region),
          model: Option.getOrUndefined(input.model),
          profile: Option.getOrUndefined(input.profile),
          voice: Option.getOrUndefined(input.voice),
          scope: Option.getOrUndefined(input.scope),
          deny: input.deny.length ? [...input.deny] : input.clearDeny ? [] : undefined,
          python: Option.getOrUndefined(input.python),
        }),
      )
      return yield* Effect.sync(() => process.stdout.write(JSON.stringify(result) + "\n"))
    }
    if (input.action === "snapshot" || input.action === "enqueue") {
      const text = Option.getOrUndefined(input.request)
      const interactionID = Option.getOrUndefined(input.interactionID)
      if (input.action === "enqueue" && (!text || !interactionID))
        return yield* Effect.fail(new Error("Voice enqueue requires --interaction-id and --request"))
      const result = yield* Effect.tryPromise(() =>
        SupervisorClient.request(
          home,
          input.action === "snapshot"
            ? { type: "voice.snapshot" }
            : { type: "voice.enqueue", interactionID: interactionID!, request: text! },
        ),
      )
      return yield* Effect.sync(() => process.stdout.write(JSON.stringify(result) + "\n"))
    }
    const directory = SupervisorSettings.assets("supervisor-voice")
    const config =
      host && input.action === "talk"
        ? { python: Option.getOrUndefined(input.python) ?? "python3" }
        : yield* Effect.tryPromise(() => SupervisorVoice.configuration(home))
    if (input.action === "serve" || input.action === "test") {
      if (!("region" in config) || !config.region || !config.model)
        return yield* Effect.fail(
          new Error("Configure voice with --region and --model before opening a speech session"),
        )
      if (input.action === "test" && Option.isNone(input.file))
        return yield* Effect.fail(new Error("Voice test requires a 16 kHz mono PCM file"))
    }
    const command = SupervisorManaged.command()
    const args =
      input.action === "talk"
        ? [
            path.join(directory, "fm-voice-client.py"),
            ...(host ? ["--host", host] : ["--local"]),
            "--relay-command-json",
            JSON.stringify([...(host ? ["shuvcode"] : command), "supervisor", "voice", "serve", "--home", home]),
            "--runs",
            String(input.runs),
            ...(Option.isSome(input.inputDevice) ? ["--input-device", input.inputDevice.value] : []),
            ...(Option.isSome(input.outputDevice) ? ["--output-device", input.outputDevice.value] : []),
          ]
        : "region" in config
          ? [
              path.join(directory, "fm-voice-relay.py"),
              ...(input.action === "test" ? ["--self-test", Option.getOrThrow(input.file)] : ["--serve"]),
              "--home",
              home,
              "--region",
              config.region!,
              "--model",
              config.model!,
              "--voice",
              config.voice,
              ...(config.profile !== undefined ? ["--profile", config.profile] : []),
            ]
          : []
    const child = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.spawn([config.python, ...args], {
          env: { ...process.env, SHUVCODE_VOICE_COMMAND_JSON: JSON.stringify(command) },
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        }),
      ),
      (child) =>
        Effect.sync(() => {
          if (child.exitCode === null) child.kill()
        }),
    )
    const code = yield* Effect.promise(() => child.exited)
    if (code !== 0) return yield* Effect.fail(new Error(`Voice process exited with status ${code}`))
  }),
)
