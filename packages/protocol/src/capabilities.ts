export * as Capabilities from "./capabilities.js"

export type Capability = "administrator" | "mobile"
export type Entry = { readonly method: string; readonly path: string; readonly capability: Capability }

// These exact method/path pairs are the runtime source of truth for device access. They mirror the
// ShuvKit operations used by OpenShuv; unlisted operations fail closed for device principals.
export const mobile = [
  ["GET", "/api/health"],
  ["GET", "/api/server"],
  ["GET", "/api/session"],
  ["POST", "/api/session"],
  ["GET", "/api/session/active"],
  ["GET", "/api/session/:sessionID"],
  ["DELETE", "/api/session/:sessionID"],
  ["GET", "/api/session/:sessionID/message"],
  ["GET", "/api/session/:sessionID/message/:messageID"],
  ["POST", "/api/session/:sessionID/prompt"],
  ["POST", "/api/session/:sessionID/interrupt"],
  ["GET", "/api/session/:sessionID/context"],
  ["GET", "/api/session/:sessionID/instructions/entries"],
  ["POST", "/api/session/:sessionID/fork"],
  ["POST", "/api/session/:sessionID/agent"],
  ["POST", "/api/session/:sessionID/model"],
  ["POST", "/api/session/:sessionID/rename"],
  ["POST", "/api/session/:sessionID/command"],
  ["POST", "/api/session/:sessionID/skill"],
  ["POST", "/api/session/:sessionID/compact"],
  ["POST", "/api/session/:sessionID/revert/stage"],
  ["POST", "/api/session/:sessionID/revert/clear"],
  ["POST", "/api/session/:sessionID/revert/commit"],
  ["GET", "/api/experimental/session/:sessionID/log"],
  ["GET", "/api/event"],
  ["GET", "/api/permission/request"],
  ["GET", "/api/permission/saved"],
  ["DELETE", "/api/permission/saved/:id"],
  ["GET", "/api/session/:sessionID/permission"],
  ["GET", "/api/session/:sessionID/permission/:requestID"],
  ["POST", "/api/session/:sessionID/permission/:requestID/reply"],
  ["GET", "/api/question/request"],
  ["GET", "/api/session/:sessionID/question"],
  ["POST", "/api/session/:sessionID/question/:requestID/reply"],
  ["POST", "/api/session/:sessionID/question/:requestID/reject"],
  ["GET", "/api/form/request"],
  ["GET", "/api/session/:sessionID/form"],
  ["GET", "/api/session/:sessionID/form/:formID/state"],
  ["POST", "/api/session/:sessionID/form/:formID/reply"],
  ["POST", "/api/session/:sessionID/form/:formID/cancel"],
  ["GET", "/api/project"],
  ["GET", "/api/project/current"],
  ["GET", "/api/project/:projectID/directories"],
  ["GET", "/api/agent"],
  ["GET", "/api/model"],
  ["GET", "/api/model/default"],
  ["GET", "/api/command"],
  ["GET", "/api/skill"],
  ["GET", "/api/vcs/status"],
  ["GET", "/api/vcs/diff"],
  ["GET", "/api/fs/read/*"],
] as const

const patterns = mobile.map(([method, path]) => ({
  method,
  pattern: new RegExp(
    "^" +
      path
        .split("/")
        .map((part) =>
          part === "*" ? ".*" : part.startsWith(":") ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        )
        .join("/") +
      "$",
  ),
}))

export function allowsMobile(method: string, pathname: string) {
  return patterns.some((entry) => entry.method === method.toUpperCase() && entry.pattern.test(pathname))
}

export function isPairingRedemption(method: string, pathname: string) {
  return method.toUpperCase() === "POST" && pathname === "/api/pairing/redeem"
}

export function requiresAdministrator(pathname: string) {
  return (
    pathname === "/api/pairing/invitation" ||
    pathname === "/api/pairing/device" ||
    pathname.startsWith("/api/pairing/device/")
  )
}
