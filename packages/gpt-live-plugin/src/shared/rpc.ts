import type { Rpc } from "@opencode/plugin/rpc"
import { z } from "zod"

/** Type-only stand-in for Rpc.define, so the terminal bundle does not pull in the schema runtime. */
function define<const D extends Rpc.PortableDefinition>(definition: D): D {
  return definition
}

export const VOICES = ["cove", "juniper", "maple", "spruce", "ember", "vale", "breeze", "arbor", "sol"] as const
export type Voice = (typeof VOICES)[number]

export const Role = z.enum(["user", "assistant"])

export const CallState = z.enum(["connecting", "live", "closed", "error"])
export type CallState = z.infer<typeof CallState>

export const TaskStatus = z.enum(["queued", "running", "done", "failed", "cancelled"])
export type TaskStatus = z.infer<typeof TaskStatus>

/**
 * Contract between the terminal plugin (audio, UI) and the server plugin
 * (ChatGPT credentials, GPT-Live control channel, OpenCode session bridge).
 */
export const GptLive = define({
  id: "gptlive",
  methods: {
    start: {
      input: z.object({
        sessionID: z.string(),
        sdp: z.string(),
        voice: z.enum(VOICES).optional(),
        /** Start a new voice session instead of continuing the linked one. */
        fresh: z.boolean().optional(),
      }),
      output: z.object({
        callID: z.string(),
        sdp: z.string(),
        model: z.string(),
        voice: z.string(),
        voiceSessionID: z.string(),
        voiceTitle: z.string(),
        /** 1 for the first call in this voice session. */
        call: z.number(),
        /** The last lines of the previous call, for context in the UI. */
        previous: z.array(z.object({ role: Role, text: z.string() })),
        /** Things to tell the user, e.g. a custom prompt that could not be read. */
        notices: z.array(z.string()).optional(),
      }),
      errors: {
        not_signed_in: z.object({ reason: z.string() }),
        busy: z.object({ callID: z.string() }),
        rejected: z.object({ status: z.number() }),
      },
    },
    stop: {
      input: z.object({ callID: z.string() }),
      output: z.object({ stopped: z.boolean() }),
    },
    status: {
      input: z.object({}),
      output: z.object({
        signedIn: z.boolean(),
        plan: z.string().optional(),
        callID: z.string().optional(),
        sessionID: z.string().optional(),
        voiceSessionID: z.string().optional(),
      }),
    },
    /** Heartbeat from the window that owns the call; calls whose window goes quiet are ended. */
    alive: {
      input: z.object({ callID: z.string() }),
      output: z.object({ active: z.boolean() }),
    },
    say: {
      input: z.object({ callID: z.string(), text: z.string() }),
      output: z.object({ sent: z.boolean() }),
    },
  },
  events: {
    state: {
      schema: z.object({
        callID: z.string(),
        state: CallState,
        message: z.string().optional(),
      }),
    },
    transcript: {
      schema: z.object({
        callID: z.string(),
        role: Role,
        text: z.string(),
        final: z.boolean(),
      }),
    },
    task: {
      schema: z.object({
        callID: z.string(),
        taskID: z.string(),
        text: z.string(),
        status: TaskStatus,
        detail: z.string().optional(),
      }),
    },
    activity: {
      schema: z.object({
        callID: z.string(),
        scope: z.enum(["voice", "main"]),
        busy: z.boolean(),
        label: z.string().optional(),
      }),
    },
  },
})
