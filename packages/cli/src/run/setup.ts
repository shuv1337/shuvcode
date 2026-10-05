import type { OpenCodeClient } from "@opencode/client/promise"

type RequestOptions = NonNullable<Parameters<OpenCodeClient["session"]["get"]>[1]>

// Subprocess tests shrink both deadlines proportionally instead of waiting them out.
const scale = Number(process.env.OPENCODE_TEST_RUN_DEADLINE_SCALE) || 1

export const RUN_SETUP_TIMEOUT_MS = 30_000 / scale

/** Admission may wait on plugin activation, so it matches the service bootstrap deadline. */
export const RUN_ADMISSION_TIMEOUT_MS = 120_000 / scale

export class RunSetupTimeoutError extends Error {}

/** Each setup call gets its own deadline; execution and its event stream have none. */
export async function runSetupRequest<T>(
  phase: string,
  request: (signal: AbortSignal) => Promise<T>,
  options?: RequestOptions,
  timeout = RUN_SETUP_TIMEOUT_MS,
) {
  process.stderr.write(`${phase}...\n`)
  const controller = new AbortController()
  const signal = options?.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal
  const expired = new RunSetupTimeoutError(`${phase} timed out after ${timeout / 1000}s`)
  const deadline = setTimeout(() => controller.abort(expired), timeout)
  try {
    const result = await request(signal).catch((error) => {
      if (controller.signal.aborted) throw expired
      throw error
    })
    if (controller.signal.aborted) throw expired
    return result
  } finally {
    clearTimeout(deadline)
  }
}

/** Bounds the session-target resolution RPCs; pass the unbounded client to execution. */
export function withRunSetupDeadlines(client: OpenCodeClient) {
  const bounded =
    <A, B>(phase: string, request: (input: A, options?: RequestOptions) => Promise<B>) =>
    (input: A, options?: RequestOptions) =>
      runSetupRequest(phase, (signal) => request(input, { ...options, signal }), options)

  const result: OpenCodeClient = {
    ...client,
    location: {
      ...client.location,
      get: (input, options) =>
        runSetupRequest("Looking up location", (signal) => client.location.get(input, { ...options, signal }), options),
    },
    model: {
      ...client.model,
      default: (input, options) =>
        runSetupRequest("Resolving model", (signal) => client.model.default(input, { ...options, signal }), options),
    },
    session: {
      ...client.session,
      get: bounded("Resolving session", client.session.get),
      list: bounded("Looking up sessions", client.session.list),
      create: bounded("Creating session", client.session.create),
      fork: bounded("Forking session", client.session.fork),
      environment: bounded("Setting session environment", client.session.environment),
      update: bounded("Updating session", client.session.update),
    },
  }
  return result
}
