import type { SupervisorStore } from "./store"
import type { SupervisorOperator } from "./operator"

type Status = SupervisorOperator.Status
type Task = Status["tasks"][number]

export namespace SupervisorFormat {
  export function homeFlag(home?: string) {
    return home ? ` --home '${home.replaceAll("'", "'\\''")}'` : ""
  }

  export function status(value: Status, selected?: string, home?: string) {
    const lines = [`Supervisor: ${value.health}`, `Project: ${value.project}`]
    if (value.projects?.length)
      lines.push(
        `Registered projects: ${value.projects.length}${value.defaultProject ? ` · default ${value.defaultProject}` : ""}`,
      )
    if (value.backlog?.length)
      lines.push(
        `Backlog: ${value.backlog.filter((item) => item.state === "queued").length} queued · ${value.backlog.filter((item) => item.state === "in-flight").length} underway`,
      )
    const gates = value.backlog?.filter((item) => item.state === "queued" && !item.readiness.eligible) ?? []
    if (gates.length)
      lines.push(`Queued gates: ${gates.map((item) => `${item.id} (${item.readiness.reasons.join(", ")})`).join("; ")}`)
    if (value.deliveries?.length)
      lines.push(
        `Deliveries: ${value.deliveries.map((item) => `${item.taskID} ${item.status}${item.blocker ? ` (${item.blocker})` : ""}`).join("; ")}`,
      )
    if (value.health !== "running") {
      lines.push(
        value.health === "stopped"
          ? `Run: shuvcode supervisor start${homeFlag(home)}`
          : `Run: shuvcode supervisor doctor${homeFlag(home)}`,
      )
    }
    if (value.error) lines.push(`Error: ${value.error}`)
    if (value.warnings?.length) lines.push(...value.warnings.map((warning) => `Needs attention: ${warning}`))
    lines.push(`Lead: ${value.leadState ?? (value.lead?.active ? "ready" : "none")}`)
    if (value.leadError) lines.push(`Lead error: ${value.leadError}`)
    lines.push(...leadPermissions(value.leadPermissions, home))
    if (value.pendingNotifications?.length) lines.push(`Pending lead updates: ${value.pendingNotifications.length}`)
    if (!value.tasks.length) {
      const work = value.backlog?.find((item) => item.id === selected)
      lines.push(
        work
          ? backlog([work])
          : selected
            ? `Task not found: ${selected}`
            : `No tasks yet. Run: shuvcode supervisor task "<brief>"${homeFlag(home)}`,
      )
      return lines.join("\n")
    }
    if (value.health === "stopped") lines.push("Task state is from the last successful status check")
    lines.push("", ...value.tasks.map((task) => taskLine(task)))
    if (selected) {
      const task = value.tasks.find((item) => item.id === selected)
      if (task) lines.push("", ...details(task, home))
    }
    return lines.join("\n")
  }

  export function taskLine(task: Task) {
    const firstLine =
      task.brief
        .split(/\r?\n/)
        .find((line) => line.trim())
        ?.trim() ?? ""
    const brief = firstLine.length > 90 ? `${firstLine.slice(0, 89).trimEnd()}…` : firstLine
    const state = task.admissionUncertain
      ? "blocked"
      : task.status === "active"
        ? (task.native?.state ?? task.state) === "running"
          ? "running"
          : "waiting"
        : task.status
    const suffix = task.admissionUncertain ? " · delivery uncertain" : task.error ? ` · ${task.error}` : ""
    const decisions = task.decisions?.filter((item) => item.resolution === undefined).length ?? 0
    const result = task.receipts?.length ? " · result ready" : ""
    const requests = task.native?.permissionRequests.length ?? 0
    return `${task.id}  ${state}  ${task.kind}  ${brief}${result}${requests ? ` · ${requests} permission${requests === 1 ? "" : "s"}` : ""}${decisions ? ` · ${decisions} decision${decisions === 1 ? "" : "s"}` : ""}${suffix}`
  }

  export function leadPermissions(requests: Status["leadPermissions"], home?: string) {
    return requests.flatMap((request) => [
      `Lead permission ${request.id}: ${request.action} ${request.resources.join(", ")}`,
      `Run: shuvcode supervisor approve lead ${request.id}${homeFlag(home)}  (or add --deny)`,
    ])
  }

  export function details(task: Task, home?: string) {
    const open = task.decisions?.filter((item) => item.resolution === undefined) ?? []
    const lines = [`Brief: ${task.brief}`, `Branch: ${task.branch}`, `Worktree: ${task.worktree}`]
    if (task.native?.pending ?? task.pending) lines.push(`Pending delivery: ${task.native?.pending ?? task.pending}`)
    if (task.receipts?.length) lines.push(`Verified receipts: ${task.receipts.length}`)
    if (task.obligations?.some((item) => item.state === "open"))
      lines.push(`Open work: ${task.obligations.filter((item) => item.state === "open").length}`)
    if (open.length) lines.push(`Open decisions: ${open.length}`)
    for (const request of task.native?.permissionRequests ?? []) {
      lines.push(`Permission ${request.id}: ${request.action} ${request.resources.join(", ")}`)
      lines.push(`Run: shuvcode supervisor approve ${task.id} ${request.id}${homeFlag(home)}  (or add --deny)`)
    }
    if (task.admissionUncertain) lines.push(`Recovery: shuvcode supervisor recover ${task.id}${homeFlag(home)}`)
    return lines
  }

  export function decision(taskID: string, item: SupervisorStore.Decision) {
    const question =
      item.payload &&
      typeof item.payload === "object" &&
      "question" in item.payload &&
      typeof item.payload.question === "string"
        ? item.payload.question
        : "Question unavailable"
    return `${taskID}  ${item.id}  ${question}`
  }

  export function projects(value: { projects: NonNullable<Status["projects"]>; defaultProject?: string }) {
    if (!value.projects.length) return "No projects registered. Run: shuvcode supervisor project add <path>"
    return value.projects
      .map(
        (item) =>
          `${item.id}${item.id === value.defaultProject ? " (default)" : ""}${item.archived ? " (archived)" : ""}  ${item.mode}  ${item.path}${item.description ? ` · ${item.description}` : ""}`,
      )
      .join("\n")
  }

  export function backlog(items: NonNullable<Status["backlog"]>) {
    if (!items.length) return "Backlog is empty"
    return items
      .map((item) => {
        const gate =
          item.state === "queued" && !item.readiness.eligible ? ` · waiting: ${item.readiness.reasons.join(", ")}` : ""
        return `${item.id}  ${item.delegatedHandoffID && item.state === "queued" ? "delegated" : item.state}  ${item.projectID}  ${item.kind}  ${item.brief.split(/\r?\n/)[0]}${item.delegatedHandoffID ? ` · handoff ${item.delegatedHandoffID}` : gate}`
      })
      .join("\n")
  }

  export function bearings(value: Status) {
    const underway = value.tasks.filter((item) => item.status === "active").map(taskLine)
    const decisions = value.tasks.flatMap((task) =>
      task.decisions
        .filter(
          (item) =>
            item.resolution === undefined &&
            item.payload !== null &&
            typeof item.payload === "object" &&
            "requiredAuthority" in item.payload &&
            item.payload.requiredAuthority === "user",
        )
        .map((item) => decision(task.id, item)),
    )
    const queued = (value.backlog ?? []).filter((item) => item.state === "queued")
    const done = (value.backlog ?? [])
      .filter((item) => item.state === "done")
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 5)
    return [
      "Underway",
      ...(underway.length ? underway : ["None"]),
      "",
      "User decisions",
      ...(decisions.length ? decisions : ["None"]),
      "",
      "Queued gates",
      ...(queued.length
        ? queued.map((item) => `${item.id}  ${item.readiness.eligible ? "ready" : item.readiness.reasons.join(", ")}`)
        : ["None"]),
      "",
      "Recent done",
      ...(done.length
        ? done.map((item) => `${item.id}  ${item.projectID}  ${item.brief.split(/\r?\n/)[0]}`)
        : ["None"]),
    ].join("\n")
  }
}
