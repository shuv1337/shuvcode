export * as Capabilities from "./capabilities.js"

import { OpenApi } from "effect/unstable/httpapi"
import { ClientApi } from "./client.js"

export type Capability = "server" | "administrator" | "mobile" | "pairing-redemption"
export type Entry = {
  readonly operationID: string
  readonly method: string
  readonly path: string
  readonly capability: Capability
}

// Capability declarations bind to endpoint-owned OpenAPI identifiers. Method and path are then
// derived from the Protocol contract, so authorization cannot drift from the routes it protects.
export const mobileOperationIDs = new Set([
  "v2.health.get",
  "v2.server.get",
  "v2.session.list",
  "v2.session.create",
  "v2.session.active",
  "v2.session.get",
  "v2.session.remove",
  "v2.session.message",
  "v2.message.list",
  "v2.session.prompt",
  "v2.session.interrupt",
  "v2.session.context",
  "v2.session.instructions.entry.list",
  "v2.session.fork",
  "v2.session.switchAgent",
  "v2.session.switchModel",
  "v2.session.rename",
  "v2.session.command",
  "v2.session.skill",
  "v2.session.compact",
  "v2.session.revert.stage",
  "v2.session.revert.clear",
  "v2.session.revert.commit",
  "v2.session.log",
  "v2.event.subscribe",
  "v2.permission.request.list",
  "v2.permission.saved.list",
  "v2.permission.saved.remove",
  "v2.session.permission.list",
  "v2.session.permission.get",
  "v2.session.permission.reply",
  "v2.question.request.list",
  "v2.session.question.list",
  "v2.session.question.reply",
  "v2.session.question.reject",
  "v2.form.request.list",
  "v2.session.form.list",
  "v2.session.form.state",
  "v2.session.form.reply",
  "v2.session.form.cancel",
  "v2.project.list",
  "v2.project.current",
  "v2.project.directories",
  "v2.agent.list",
  "v2.model.list",
  "v2.model.default",
  "v2.command.list",
  "v2.skill.list",
  "v2.vcs.status",
  "v2.vcs.diff",
  "v2.fs.read",
])

const publicOperationIDs = new Set(["v2.pairing.redeem"])
const administratorOperationIDs = new Set([
  "v2.pairing.invitation.create",
  "v2.pairing.device.list",
  "v2.pairing.device.revoke",
])

export const routes: ReadonlyArray<Entry> = Object.entries(OpenApi.fromApi(ClientApi).paths).flatMap(
  ([path, operations]) =>
    Object.entries(operations).flatMap(([method, operation]) => {
      if (method === "parameters" || !operation || !("operationId" in operation) || !operation.operationId) return []
      const capability = publicOperationIDs.has(operation.operationId)
        ? "pairing-redemption"
        : mobileOperationIDs.has(operation.operationId)
          ? "mobile"
          : administratorOperationIDs.has(operation.operationId)
            ? "administrator"
            : "server"
      return [
        {
          operationID: operation.operationId,
          method: method.toUpperCase(),
          path: path.replace(/\{([^/}]+)\}/g, ":$1"),
          capability,
        },
      ]
    }),
)

const patterns = routes.map((entry) => ({
  entry,
  pattern: new RegExp(
    "^" +
      entry.path
        .split("/")
        .map((part) =>
          part === "*" ? ".*" : part.startsWith(":") ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        )
        .join("/") +
      "$",
  ),
}))

export function classify(method: string, pathname: string) {
  return patterns.find(
    (candidate) => candidate.entry.method === method.toUpperCase() && candidate.pattern.test(pathname),
  )?.entry.capability
}

export function allowsMobile(method: string, pathname: string) {
  return classify(method, pathname) === "mobile"
}

export function isPairingRedemption(method: string, pathname: string) {
  return classify(method, pathname) === "pairing-redemption"
}

export function requiresAdministrator(method: string, pathname: string) {
  return classify(method, pathname) === "administrator"
}
