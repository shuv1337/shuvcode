// Parent shuvcode sessions pin OPENCODE_CONFIG_DIR. Spawned CLIs prefer that
// pin over XDG_CONFIG_HOME, so sandboxed tests must not inherit OPENCODE_*.
export function cleanProcessEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith("OPENCODE_"),
    ),
  )
}
