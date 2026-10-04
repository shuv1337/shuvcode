import path from "path"

// Mise keeps trust in $XDG_STATE_HOME/mise. Core tests point HOME and the XDG
// dirs at a temp folder, so a `node` shim then treats the real
// ~/.config/mise/config.toml (discovered by walking up from the repo) as an
// untrusted project config and exits 1. Resolve the binary while the parent
// environment is still trusted.
export async function nodeBinDirectory(env: NodeJS.ProcessEnv) {
  const key = pathKey(env)
  const node = Bun.which("node", { PATH: key ? (env[key] ?? "") : "" })
  if (!node) return

  const result = Bun.spawnSync({
    cmd: [node, "-e", "process.stdout.write(process.execPath)"],
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    timeout: 15_000,
  })
  if (result.exitCode !== 0) return

  const executable = result.stdout.toString().trim()
  if (!isNodeExecutable(executable)) return
  if (!(await Bun.file(executable).exists())) return
  return path.dirname(executable)
}

export function prependNodeBin(env: NodeJS.ProcessEnv, bin: string | undefined) {
  if (!bin) return env
  const key = pathKey(env) ?? "PATH"
  const current = env[key]
  const entries =
    typeof current === "string" ? current.split(path.delimiter).filter((entry) => entry.length > 0) : []
  if (entries[0] === bin) return env
  return {
    ...env,
    [key]: [bin, ...entries.filter((entry) => entry !== bin)].join(path.delimiter),
  }
}

function pathKey(env: NodeJS.ProcessEnv) {
  return Object.keys(env).find((name) => name.toLowerCase() === "path")
}

function isNodeExecutable(executable: string) {
  if (!path.isAbsolute(executable)) return false
  const base = path.basename(executable).toLowerCase()
  return base === "node" || base === "node.exe"
}
