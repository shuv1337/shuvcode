import { OpenCode } from "@opencode/client"
import path from "node:path"
import { rm } from "node:fs/promises"
import { realpath } from "node:fs/promises"
import { Schema } from "effect"
import { SupervisorClient } from "./client"
import { SupervisorManaged } from "./managed"
import { SupervisorNative } from "./native"
import { SupervisorProtocol } from "./protocol"
import { SupervisorProjects } from "./projects"
import { SupervisorSettings } from "./settings"
import { SupervisorPresentation } from "./presentation"
import { SupervisorHerdr } from "./herdr"

export namespace SupervisorOperator {
  const Permission = Schema.Struct({
    action: Schema.String,
    resource: Schema.String,
    effect: Schema.Literals(["allow", "deny", "ask"]),
  })
  const Project = Schema.Struct({
    id: Schema.String,
    path: Schema.String,
    description: Schema.String,
    baseRef: Schema.String,
    mode: SupervisorProtocol.ProjectMode,
    yolo: Schema.Boolean,
    model: Schema.optional(SupervisorProtocol.Model),
    agent: Schema.optional(Schema.String),
    permissions: Schema.optional(Schema.Array(Permission)),
    archived: Schema.Boolean,
    createdAt: Schema.Number,
    updatedAt: Schema.Number,
  })
  const Dependency = Schema.Struct({ id: Schema.String, when: Schema.Literals(["done", "landed"]) })
  const Work = Schema.Struct({
    id: Schema.String,
    projectID: Schema.String,
    kind: Schema.Literals(["ship", "scout"]),
    brief: Schema.String,
    deliveryMode: SupervisorProtocol.DeliveryMode,
    mergePolicy: SupervisorProtocol.MergePolicy,
    classification: Schema.optional(Schema.String),
    overrides: Schema.Struct({
      baseRef: Schema.optional(Schema.String),
      model: Schema.optional(SupervisorProtocol.Model),
      agent: Schema.optional(Schema.String),
      permissions: Schema.optional(Schema.Array(Permission)),
    }),
    dependencies: Schema.Array(Dependency),
    resources: Schema.Array(Schema.String),
    priority: Schema.Number,
    notBefore: Schema.optional(Schema.Number),
    hold: Schema.optional(SupervisorProtocol.Hold),
    state: Schema.Literals(["queued", "in-flight", "done", "cancelled"]),
    attempt: Schema.Number,
    taskID: Schema.optional(Schema.String),
    delegatedHandoffID: Schema.optional(Schema.String),
    landed: Schema.optional(Schema.Json),
    createdAt: Schema.Number,
    updatedAt: Schema.Number,
  })
  const BacklogEntry = Schema.Struct({
    ...Work.fields,
    readiness: Schema.Struct({
      eligible: Schema.Boolean,
      reasons: Schema.Array(Schema.String),
      dependencies: Schema.Array(
        Schema.Struct({
          ...Dependency.fields,
          state: Schema.optional(Work.fields.state),
          landed: Schema.Boolean,
          met: Schema.Boolean,
        }),
      ),
    }),
  })
  const Delivery = Schema.Struct({
    taskID: Schema.String,
    status: Schema.Literals(["pending", "validating", "ready", "landed", "blocked", "cancelled"]),
    mode: SupervisorProtocol.DeliveryMode,
    mergePolicy: SupervisorProtocol.MergePolicy,
    blocker: Schema.optional(Schema.String),
  })
  const Task = Schema.Struct({
    id: Schema.String,
    kind: Schema.Literals(["ship", "scout"]),
    project: Schema.String,
    worktree: Schema.String,
    branch: Schema.String,
    baseRef: Schema.String,
    baseCommit: Schema.String,
    sessionID: Schema.String,
    brief: Schema.String,
    model: Schema.Struct({
      providerID: Schema.String,
      modelID: Schema.String,
      variant: Schema.optional(Schema.String),
    }),
    agent: Schema.String,
    permissions: Schema.Array(Permission),
    status: Schema.Literals(["active", "cancelling", "cancelled", "completed"]),
    cursor: Schema.Number,
    provisioned: Schema.Boolean,
    admissionUncertain: Schema.Boolean,
    error: Schema.optional(Schema.String),
    executionOutcome: Schema.optional(Schema.Literals(["succeeded", "failed", "interrupted"])),
    native: Schema.optional(
      Schema.Struct({
        state: Schema.Literals(["running", "idle", "unknown"]),
        pending: Schema.Number,
        permissions: Schema.Number,
        permissionRequests: Schema.Array(
          Schema.Struct({ id: Schema.String, action: Schema.String, resources: Schema.Array(Schema.String) }),
        ),
      }),
    ),
    receipts: Schema.Array(
      Schema.Struct({ operationID: Schema.String, kind: Schema.Literals(["ship", "scout"]), evidence: Schema.Json }),
    ),
    decisions: Schema.Array(
      Schema.Struct({
        taskID: Schema.String,
        id: Schema.String,
        payload: Schema.Json,
        resolution: Schema.optional(Schema.Json),
      }),
    ),
    obligations: Schema.Array(
      Schema.Struct({
        taskID: Schema.String,
        operationID: Schema.String,
        payload: Schema.Struct({ text: Schema.String, delivery: Schema.Literals(["steer", "queue"]) }),
        state: Schema.Literals(["open", "settled", "cancelled"]),
        delivered: Schema.Boolean,
      }),
    ),
    cleanup: Schema.optional(Schema.Json),
  })
  const Snapshot = Schema.Struct({
    lead: Schema.optional(
      Schema.Struct({ sessionID: Schema.String, generation: Schema.Number, active: Schema.Boolean }),
    ),
    tasks: Schema.Array(Task),
    pendingNotifications: Schema.optional(Schema.Array(Schema.Unknown)),
    observedAt: Schema.optional(Schema.Number),
    projects: Schema.optional(Schema.Array(Project)),
    defaultProject: Schema.optional(Schema.String),
    backlog: Schema.optional(Schema.Array(BacklogEntry)),
    deliveries: Schema.optional(Schema.Array(Delivery)),
    warnings: Schema.optional(Schema.Array(Schema.String)),
  })
  const Lead = Schema.Struct({ sessionID: Schema.String, provisioned: Schema.Boolean })
  type Home = { home?: string }
  type TaskInput = Home & { task: string }
  type StatusResult = Awaited<ReturnType<typeof status>>
  export type Status = Omit<
    StatusResult,
    "projects" | "defaultProject" | "backlog" | "deliveries" | "warnings" | "herdr"
  > &
    Partial<Pick<StatusResult, "projects" | "defaultProject" | "backlog" | "deliveries" | "warnings" | "herdr">>

  export const init = SupervisorSettings.init

  export async function open(input: SupervisorSettings.Init & { noOpen?: boolean }) {
    const home = SupervisorSettings.home(input.home)
    const existing = await Bun.file(path.join(home, "settings.json")).exists()
    const settings = await init({
      ...input,
      home,
      ...(!existing && !input.project ? { project: home, registerProject: false } : {}),
    })
    await SupervisorHerdr.enable(settings)
    await start({ home })
    const current = await lead({ home })
    if (!input.noOpen && !(await SupervisorHerdr.focus(settings, current.sessionID).catch(() => false)))
      await attach({ home, sessionID: current.sessionID })
    return current
  }

  export async function up(input: SupervisorSettings.Init) {
    const settings = await init(input)
    await start({ home: settings.home })
    const current = await lead({ home: settings.home })
    return { ...settings, sessionID: current.sessionID }
  }

  export async function start(input: Home) {
    const settings = await SupervisorSettings.read(input.home)
    const process = await SupervisorManaged.start(settings.home)
    return { home: settings.home, endpoint: settings.endpoint, ...process }
  }

  export async function stop(input: Home) {
    const settings = await SupervisorSettings.read(input.home)
    await status(input).catch(() => undefined)
    await SupervisorManaged.stop(settings.home)
  }

  export async function status(input: Home & { task?: string }) {
    const settings = await SupervisorSettings.read(input.home)
    const current = await SupervisorManaged.owner(settings.home)
    const alive = current ? await SupervisorManaged.running(current.owner) : false
    const snapshot = await SupervisorClient.request(settings.home, { type: "status" })
      .then((result) => Schema.decodeUnknownSync(Snapshot)(result))
      .then(async (result) => {
        await SupervisorSettings.write(settings.home, "last-status.json", { ...result, observedAt: Date.now() })
        return result
      })
      .catch(async (error) => {
        if (alive)
          throw new Error(
            `Supervisor is unreachable: ${error instanceof Error ? error.message : "request failed"}. Run: shuvcode supervisor doctor`,
          )
        return await Bun.file(path.join(settings.home, "last-status.json"))
          .json()
          .then(Schema.decodeUnknownSync(Snapshot))
          .catch(() => ({
            tasks: [],
            lead: undefined,
            pendingNotifications: [],
            observedAt: undefined,
            projects: undefined,
            defaultProject: undefined,
            backlog: undefined,
            deliveries: undefined,
            warnings: undefined,
          }))
      })
    const health = alive ? await SupervisorClient.health(settings.home).catch(() => undefined) : undefined
    const startup = !alive
      ? await Bun.file(path.join(settings.home, "startup-error.json"))
          .json()
          .then(Schema.decodeUnknownSync(Schema.Struct({ error: Schema.String })))
          .catch(() => undefined)
      : undefined
    const observed =
      alive && snapshot.lead?.active
        ? await readLead(settings, snapshot.lead.sessionID).catch((error) => ({
            state: "failed" as const,
            text: error instanceof Error ? error.message : "Lead unavailable",
            error: "Lead unavailable",
            permissions: [],
          }))
        : undefined
    const herdr = await Bun.file(path.join(settings.home, "herdr-status.json"))
      .json()
      .then(Schema.decodeUnknownSync(SupervisorHerdr.Status))
      .catch(() => undefined)
    return {
      home: settings.home,
      project: settings.project,
      endpoint: settings.endpoint,
      model: settings.model,
      health: alive ? ("running" as const) : ("stopped" as const),
      herdr: herdr && { ...herdr, available: alive && herdr.available && Date.now() - herdr.observedAt < 5000 },
      error: health?.error ?? startup?.error,
      warnings: snapshot.warnings ?? [],
      lead: snapshot.lead,
      leadState: observed?.state ?? (snapshot.lead?.active && !alive ? ("stopped" as const) : undefined),
      leadError: observed?.error,
      leadPermissions: observed?.permissions ?? [],
      snapshotObservedAt: alive ? undefined : snapshot.observedAt,
      pendingNotifications: snapshot.pendingNotifications ?? [],
      projects: snapshot.projects,
      defaultProject: snapshot.defaultProject,
      backlog: snapshot.backlog,
      deliveries: snapshot.deliveries,
      tasks: snapshot.tasks
        .filter(
          (task) =>
            !input.task || task.id === (snapshot.backlog?.find((work) => work.id === input.task)?.taskID ?? input.task),
        )
        .map((task) => ({ ...task, state: task.native?.state, pending: task.native?.pending })),
    }
  }

  export async function lead(input: Home & { session?: string; fresh?: boolean }) {
    const settings = await SupervisorSettings.read(input.home)
    await start({ home: settings.home })
    const current = await status({ home: settings.home })
    const native = SupervisorNative.connect({
      url: settings.endpoint,
      password: await SupervisorSettings.password(settings),
    })
    if (current.lead?.active && !input.session && !input.fresh) {
      await native.get(current.lead.sessionID)
      return { home: settings.home, endpoint: settings.endpoint, sessionID: current.lead.sessionID }
    }
    const saved =
      !input.fresh && !input.session && (await Bun.file(path.join(settings.home, "lead.json")).exists())
        ? Schema.decodeUnknownSync(Lead)(await Bun.file(path.join(settings.home, "lead.json")).json())
        : undefined
    const sessionID = input.session ?? saved?.sessionID ?? `ses_lead_${crypto.randomUUID().replaceAll("-", "")}`
    if (input.session || saved?.provisioned) await native.get(sessionID)
    if (!input.session && !saved?.provisioned) {
      await SupervisorSettings.write(settings.home, "lead.json", { sessionID, provisioned: false })
      await native.create({
        sessionID,
        directory: settings.project,
        agent: settings.mode === "managed" ? "supervisor-lead" : settings.agent,
        model: { providerID: settings.model.providerID, id: settings.model.modelID },
        permissions: SupervisorSettings.permissions(settings),
        title: "Supervisor lead",
      })
      await SupervisorSettings.write(settings.home, "lead.json", { sessionID, provisioned: true })
    }
    await native.pluginReady(settings.project, "native-supervisor-pilot")
    await SupervisorClient.request(settings.home, {
      type: "lead.activate",
      sessionID,
      expectedGeneration: current.lead?.generation ?? 0,
      adoptPending: Boolean(input.fresh || input.session),
    })
    return { home: settings.home, endpoint: settings.endpoint, sessionID }
  }

  export async function resolveAttachment(input: {
    home: string
    sessionID: string
    homeID?: string
    location?: string
  }) {
    const settings = await SupervisorSettings.read(input.home)
    if (input.homeID && settings.pilotID !== input.homeID) throw new Error("Supervisor home identity changed")
    const session = await SupervisorNative.connect({
      url: settings.endpoint,
      password: await SupervisorSettings.password(settings),
    }).get(input.sessionID)
    if (session.id !== input.sessionID || session.parentID)
      throw new Error("Attachment requires the exact root Session")
    const location = await realpath(session.location.directory)
    if (input.location && location !== (await realpath(input.location))) throw new Error("Session location changed")
    return {
      settings,
      session,
      location,
      attachment: SupervisorPresentation.attachment({
        settings,
        sessionID: session.id,
        location,
        command: SupervisorManaged.command(),
      }),
    }
  }

  export async function attach(input: { home: string; sessionID: string; homeID?: string; location?: string }) {
    const resolved = await resolveAttachment(input)
    const child = Bun.spawn(
      [
        ...SupervisorManaged.command(),
        "--server",
        resolved.settings.endpoint,
        "--session",
        resolved.session.id,
        "--attach-only",
        resolved.location,
      ],
      {
        cwd: resolved.location,
        env: SupervisorSettings.clientEnvironment(
          resolved.settings,
          await SupervisorSettings.password(resolved.settings),
        ),
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      },
    )
    if ((await child.exited) !== 0) throw new Error("Session view exited with an error")
  }

  export async function presentation(input: Home) {
    const settings = await SupervisorSettings.read(input.home)
    const facts = Schema.decodeUnknownSync(SupervisorPresentation.Facts)(
      await SupervisorClient.request(settings.home, { type: "presentation" }),
    )
    return SupervisorPresentation.read({
      settings,
      facts,
      native: SupervisorNative.connect({
        url: settings.endpoint,
        password: await SupervisorSettings.password(settings),
      }),
      command: SupervisorManaged.command(),
    })
  }

  export async function send(input: Home & { text: string }) {
    const session = await lead(input)
    const settings = await SupervisorSettings.read(session.home)
    const pendingFile = path.join(settings.home, "lead-send.json")
    const pending = (await Bun.file(pendingFile).exists())
      ? Schema.decodeUnknownSync(
          Schema.Struct({ sessionID: Schema.String, messageID: Schema.String, text: Schema.String }),
        )(await Bun.file(pendingFile).json())
      : undefined
    if (pending && (pending.sessionID !== session.sessionID || pending.text !== input.text))
      throw new Error(
        "The previous lead message has an unknown delivery result. Retry that same message first; it will reuse its original ID.",
      )
    const messageID = pending?.messageID ?? `msg_${crypto.randomUUID().replaceAll("-", "")}`
    await SupervisorSettings.write(settings.home, "lead-send.json", {
      sessionID: session.sessionID,
      messageID,
      text: input.text,
    })
    await SupervisorNative.connect({
      url: settings.endpoint,
      password: await SupervisorSettings.password(settings),
    }).prompt({ sessionID: session.sessionID, id: messageID, text: input.text, delivery: "steer", resume: true })
    await rm(pendingFile, { force: true })
    return { sessionID: session.sessionID, messageID }
  }

  export async function read(input: Home) {
    const settings = await SupervisorSettings.read(input.home)
    const current = await status(input)
    if (!current.lead?.active) throw new Error("No active lead. Run: shuvcode supervisor lead --no-open")
    return readLead(settings, current.lead.sessionID)
  }

  async function readLead(settings: SupervisorSettings.Value & { home: string }, sessionID: string) {
    const native = SupervisorNative.connect({
      url: settings.endpoint,
      password: await SupervisorSettings.password(settings),
    })
    const messages = await native.messages(sessionID, { type: "assistant", order: "desc", limit: 1 })
    const response = messages.data.find((message) => message.type === "assistant")
    const error = response?.error?.message ?? response?.retry?.error.message
    const permissions = await native.permissions(settings.project, sessionID)
    return {
      state: permissions.length
        ? ("permission" as const)
        : (await native.active()).includes(sessionID)
          ? response?.retry
            ? ("retrying" as const)
            : ("running" as const)
          : response?.error
            ? ("failed" as const)
            : ("idle" as const),
      text: error ?? response?.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n") ?? "",
      error,
      permissions: permissions.map((item) => ({ id: item.id, action: item.action, resources: item.resources })),
    }
  }

  export async function projects(input: Home & { includeArchived?: boolean }) {
    const settings = await SupervisorSettings.read(input.home)
    return Schema.decodeUnknownSync(
      Schema.Struct({ projects: Schema.Array(Project), defaultProject: Schema.optional(Schema.String) }),
    )(await SupervisorClient.request(settings.home, { type: "project.list", includeArchived: input.includeArchived }))
  }

  export async function projectAdd(
    input: Home & {
      id?: string
      path?: string
      url?: string
      initialize?: boolean
      description?: string
      baseRef?: string
      mode?: SupervisorProjects.Mode
      yolo?: boolean
      model?: string
      agent?: string
    },
  ) {
    return Schema.decodeUnknownSync(Project)(
      await operate(input, {
        type: "project.add",
        generation: 0,
        id: input.id,
        path: input.path,
        url: input.url,
        initialize: input.initialize,
        description: input.description,
        baseRef: input.baseRef,
        mode: input.mode,
        yolo: input.yolo,
        model: input.model ? SupervisorSettings.model(input.model) : undefined,
        agent: input.agent,
      }),
    )
  }

  export async function projectSet(
    input: Home & {
      id: string
      description?: string
      baseRef?: string
      mode?: SupervisorProjects.Mode
      yolo?: boolean
      model?: string
      agent?: string
    },
  ) {
    return Schema.decodeUnknownSync(Project)(
      await operate(input, {
        type: "project.update",
        generation: 0,
        id: input.id,
        description: input.description,
        baseRef: input.baseRef,
        mode: input.mode,
        yolo: input.yolo,
        model: input.model ? SupervisorSettings.model(input.model) : undefined,
        agent: input.agent,
      }),
    )
  }

  export async function projectDefault(input: Home & { id: string }) {
    return Schema.decodeUnknownSync(Project)(
      await operate(input, { type: "project.default", generation: 0, id: input.id }),
    )
  }
  export async function projectArchive(input: Home & { id: string }) {
    return Schema.decodeUnknownSync(Project)(
      await operate(input, { type: "project.archive", generation: 0, id: input.id }),
    )
  }
  export async function projectRestore(input: Home & { id: string }) {
    return Schema.decodeUnknownSync(Project)(
      await operate(input, { type: "project.restore", generation: 0, id: input.id }),
    )
  }

  export async function backlog(
    input: Home & { project?: string; state?: "queued" | "in-flight" | "done" | "cancelled" },
  ) {
    const current = await status(input)
    return (current.backlog ?? []).filter(
      (item) => (!input.project || item.projectID === input.project) && (!input.state || item.state === input.state),
    )
  }

  export async function task(
    input: Home & {
      brief: string
      name?: string
      kind: "ship" | "scout"
      project?: string
      base?: string
      model?: string
      agent?: string
      dependsOn?: readonly string[]
      afterLanded?: readonly string[]
      hold?: string
      until?: string
      notBefore?: string
      resources?: readonly string[]
      priority?: number
      mode?: "no-mistakes" | "direct-PR" | "local-only"
      mergePolicy?: "auto" | "manual"
      classification?: "internal" | "product" | "mixed" | "uncertain"
    },
  ) {
    await lead(input)
    const current = await status(input)
    const project = input.project
      ? current.projects?.find((item) => item.id === input.project || item.path === path.resolve(input.project!))
      : current.projects?.find((item) => item.id === current.defaultProject)
    if (!project || project.archived)
      throw new Error(`Register or select an active project before creating work: ${input.project ?? "default"}`)
    if (input.until && !input.hold) throw new Error("--until requires --hold")
    const taskID =
      input.name ??
      `${
        input.brief
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 36) || "task"
      }-${crypto.randomUUID().slice(0, 6)}`
    return Schema.decodeUnknownSync(Work)(
      await operate(input, {
        type: "work.create",
        id: taskID,
        projectID: project.id,
        kind: input.kind,
        brief: input.brief,
        baseRef: input.base,
        model: input.model ? SupervisorSettings.model(input.model) : undefined,
        agent: input.agent,
        dependencies: [
          ...(input.dependsOn ?? []).map((id) => ({ id, when: "done" as const })),
          ...(input.afterLanded ?? []).map((id) => ({ id, when: "landed" as const })),
        ],
        resources: [...(input.resources ?? [])],
        priority: input.priority,
        mode: input.mode,
        mergePolicy: input.mergePolicy,
        classification: input.classification,
        hold: input.hold ? { reason: input.hold, until: input.until ? parseTime(input.until) : undefined } : undefined,
        notBefore: input.notBefore ? parseTime(input.notBefore) : undefined,
        generation: 0,
      }),
    )
  }

  export async function hold(input: Home & { id: string; reason: string; until?: string }) {
    return Schema.decodeUnknownSync(Work)(
      await operate(input, {
        type: "work.hold",
        generation: 0,
        id: input.id,
        reason: input.reason,
        until: input.until ? parseTime(input.until) : undefined,
      }),
    )
  }
  export async function release(input: Home & { id: string }) {
    return Schema.decodeUnknownSync(Work)(await operate(input, { type: "work.release", generation: 0, id: input.id }))
  }
  export async function retry(input: Home & { id: string }) {
    return Schema.decodeUnknownSync(Work)(await operate(input, { type: "work.retry", generation: 0, id: input.id }))
  }
  export async function dispatch(input: Home & { id: string }) {
    return operate(input, { type: "work.dispatch", generation: 0, id: input.id })
  }
  export async function interrupt(input: Home & { task: string }) {
    return operate(input, { type: "task.interrupt", generation: 0, taskID: input.task })
  }
  export async function resume(input: Home & { task: string; text?: string }) {
    return operate(input, {
      type: "task.resume",
      generation: 0,
      taskID: input.task,
      operationID: `msg_${crypto.randomUUID().replaceAll("-", "")}`,
      text: input.text,
    })
  }

  export async function steer(input: TaskInput & { text: string; queue: boolean }) {
    return operate(input, {
      type: "task.send",
      generation: 0,
      taskID: input.task,
      operationID: `msg_${crypto.randomUUID().replaceAll("-", "")}`,
      text: input.text,
      delivery: input.queue ? "queue" : "steer",
    })
  }
  export async function cancel(input: TaskInput) {
    const item = (await status(input)).backlog?.find((work) => work.id === input.task || work.taskID === input.task)
    if (item) return operate(input, { type: "work.cancel", id: item.id, generation: 0 })
    return operate(input, { type: "task.cancel", taskID: input.task, generation: 0 })
  }
  export async function complete(input: TaskInput) {
    const item = (await status(input)).backlog?.find((work) => work.id === input.task)
    return operate(input, { type: "task.complete", taskID: item?.taskID ?? input.task, generation: 0 })
  }
  export async function cleanup(input: TaskInput & { landed: string }) {
    return operate(input, { type: "task.cleanup", taskID: input.task, generation: 0, landingRef: input.landed })
  }
  export async function answer(input: TaskInput & { decision: string; text: string }) {
    return operate(input, {
      type: "decision.resolve",
      taskID: input.task,
      generation: 0,
      id: input.decision,
      answer: input.text,
    })
  }

  export async function recover(input: TaskInput) {
    const settings = await SupervisorSettings.read(input.home)
    if (settings.mode !== "managed")
      throw new Error(
        "Recovery requires the pilot's own native server; external servers cannot be restarted by this command",
      )
    requiredTask(await status(input), input.task)
    await stop(input)
    await start(input)
    return requiredTask(await status(input), input.task)
  }

  export async function show(input: TaskInput) {
    const current = await status(input)
    const work = current.backlog?.find((item) => item.id === input.task)
    if (work && !work.taskID) {
      if (!work.delegatedHandoffID) return { work, task: undefined, report: undefined, delegation: undefined }
      const handoff = Schema.decodeUnknownSync(
        Schema.Struct({
          id: Schema.String,
          delegateID: Schema.String,
          state: Schema.String,
          result: Schema.optional(
            Schema.Struct({
              work: Schema.Array(
                Schema.Struct({
                  sourceID: Schema.String,
                  report: Schema.optional(
                    Schema.Struct({
                      evidence: Schema.Struct({ artifact: Schema.Struct({ contentBase64: Schema.String }) }),
                    }),
                  ),
                }),
              ),
            }),
          ),
        }),
      )(await SupervisorClient.request(current.home, { type: "handoff.status", id: work.delegatedHandoffID }))
      const report = handoff.result?.work.find((item) => item.sourceID === work.id)?.report
      return {
        work,
        task: undefined,
        delegation: { id: handoff.id, delegateID: handoff.delegateID, state: handoff.state },
        report: report ? Buffer.from(report.evidence.artifact.contentBase64, "base64").toString("utf8") : undefined,
      }
    }
    const task = requiredTask(current, input.task)
    const receipt = task.receipts.at(-1)
    const evidence = receipt
      ? Schema.decodeUnknownSync(Schema.Struct({ artifact: Schema.Struct({ contentBase64: Schema.String }) }))(
          receipt.evidence,
        )
      : undefined
    return {
      task,
      work,
      delegation: undefined,
      report: evidence ? Buffer.from(evidence.artifact.contentBase64, "base64").toString("utf8") : undefined,
    }
  }

  export async function doctor(input: Home) {
    const settings = await SupervisorSettings.read(input.home)
    const checks: { name: string; status: "ok" | "warn" | "error"; detail?: string }[] = [
      { name: "Home", status: "ok", detail: settings.home },
    ]
    const current = await status(input).catch((error) => {
      checks.push({ name: "Supervisor", status: "error", detail: error.message })
      return undefined
    })
    const reachable = await SupervisorNative.connect({
      url: settings.endpoint,
      password: await SupervisorSettings.password(settings),
      timeoutMs: 1500,
    })
      .info()
      .then(() => true)
      .catch(() => false)
    checks.push({
      name: "Native server",
      status: reachable ? "ok" : "warn",
      detail: reachable ? `${settings.mode} server responding` : "not responding",
    })
    if (current) {
      checks.push({ name: "Supervisor", status: current.health === "running" ? "ok" : "warn", detail: current.health })
      if (current.error) checks.push({ name: "Supervisor error", status: "error", detail: current.error })
      if (current.leadError) checks.push({ name: "Lead", status: "error", detail: current.leadError })
      if (current.leadPermissions.length)
        checks.push({
          name: "Lead",
          status: "warn",
          detail: "Permission approval needed. Run supervisor status for the approval command.",
        })
      for (const task of current.tasks) {
        if (task.error) checks.push({ name: task.id, status: "error", detail: task.error })
        if (task.native?.permissions)
          checks.push({
            name: task.id,
            status: "warn",
            detail: `${task.native.permissions} permission request(s). Run: shuvcode supervisor status --task ${task.id}`,
          })
      }
    }
    return { checks }
  }

  export async function approve(input: TaskInput & { request: string; deny: boolean }) {
    const settings = await SupervisorSettings.read(input.home)
    const current = await status(input)
    const task = input.task === "lead" ? undefined : requiredTask(current, input.task)
    const requests = input.task === "lead" ? current.leadPermissions : task?.native?.permissionRequests
    const sessionID = input.task === "lead" ? current.lead?.sessionID : task?.sessionID
    if (!sessionID || !requests?.some((request) => request.id === input.request))
      throw new Error("Permission request does not belong to this task or is no longer pending")
    const password = await SupervisorSettings.password(settings)
    const client = OpenCode.make({
      baseUrl: settings.endpoint,
      headers: password ? { authorization: `Basic ${btoa(`opencode:${password}`)}` } : undefined,
    })
    await client.permission.reply({
      sessionID,
      requestID: input.request,
      decision: input.deny ? "reject" : "once",
    })
  }

  export async function operate(input: Home, operation: SupervisorProtocol.Operation) {
    const current = await status(input)
    if (!current.lead?.active) throw new Error("No active lead. Run: shuvcode supervisor lead --no-open")
    const taskID =
      "taskID" in operation && operation.type !== "decision.resolve"
        ? (current.backlog?.find((work) => work.id === operation.taskID)?.taskID ?? operation.taskID)
        : undefined
    return SupervisorClient.request(
      current.home,
      SupervisorProtocol.decode({ ...operation, ...(taskID ? { taskID } : {}), generation: current.lead.generation }),
    )
  }

  function requiredTask(value: Awaited<ReturnType<typeof status>>, id: string) {
    const taskID = value.backlog?.find((work) => work.id === id)?.taskID ?? id
    const task = value.tasks.find((task) => task.id === taskID)
    if (!task) throw new Error(`Unknown supervisor task: ${id}`)
    return task
  }

  function parseTime(value: string) {
    const time = /^\d{4}-\d\d-\d\dT/.test(value) ? Date.parse(value) : NaN
    if (!Number.isFinite(time)) throw new Error(`Expected ISO date/time: ${value}`)
    return time
  }
}
