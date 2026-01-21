import fs from "node:fs/promises"
import net from "node:net"
import os from "node:os"
import path from "node:path"

const isWindows = process.platform === "win32"

async function freePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to acquire a free port")))
        return
      }
      server.close((err) => {
        if (err) {
          reject(err)
          return
        }
        resolve(address.port)
      })
    })
  })
}

async function waitForHealth(url: string, server: Bun.Subprocess) {
  const timeoutMs = process.env.CI ? 180_000 : 60_000
  const timeout = Date.now() + timeoutMs
  let attempts = 0

  // Give the server a moment to start on Windows
  if (isWindows) {
    await new Promise((r) => setTimeout(r, 2000))
  }

  while (Date.now() < timeout) {
    attempts++
    if (attempts % 20 === 0) {
      console.log(
        `[e2e] Health check attempt ${attempts}, elapsed: ${Math.round((Date.now() - (timeout - timeoutMs)) / 1000)}s`,
      )
    }

    const ok = await fetch(url)
      .then((r) => r.ok)
      .catch(() => false)
    if (ok) {
      console.log(`[e2e] Server healthy after ${attempts} attempts`)
      return
    }

    const exited = await Promise.race([
      server.exited.then(() => true).catch(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 0)),
    ])

    if (exited) {
      throw new Error(`Server exited before health check: ${url}`)
    }

    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`Timed out waiting for server health after ${timeoutMs / 1000}s: ${url}`)
}

const appDir = process.cwd()
const repoDir = path.resolve(appDir, "../..")
const opencodeDir = path.join(repoDir, "packages", "opencode")
const modelsJson = path.join(opencodeDir, "test", "tool", "fixtures", "models-api.json")

const extraArgs = (() => {
  const args = process.argv.slice(2)
  if (args[0] === "--") return args.slice(1)
  return args
})()

const serverHost = process.env.OPENCODE_E2E_SERVER_HOST ?? "127.0.0.1"
// Use fixed ports on Windows to avoid port binding race conditions
const serverPort = isWindows ? 14096 : await freePort()
const webPort = isWindows ? 14097 : await freePort()
console.log(`[e2e] Using server port ${serverPort}, web port ${webPort}`)

const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-e2e-"))

const serverEnv = {
  ...process.env,
  MODELS_DEV_API_JSON: modelsJson,
  OPENCODE_DISABLE_MODELS_FETCH: "true",
  OPENCODE_DISABLE_SHARE: "true",
  OPENCODE_DISABLE_LSP_DOWNLOAD: "true",
  OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
  OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "true",
  OPENCODE_TEST_HOME: path.join(sandbox, "home"),
  XDG_DATA_HOME: path.join(sandbox, "share"),
  XDG_CACHE_HOME: path.join(sandbox, "cache"),
  XDG_CONFIG_HOME: path.join(sandbox, "config"),
  XDG_STATE_HOME: path.join(sandbox, "state"),
  OPENCODE_E2E_PROJECT_DIR: repoDir,
  OPENCODE_E2E_SESSION_TITLE: "E2E Session",
  OPENCODE_E2E_MESSAGE: "Seeded for UI e2e",
  OPENCODE_E2E_MODEL: "opencode/gpt-5-nano",
  OPENCODE_CLIENT: "app",
} satisfies Record<string, string>

const runnerEnv = {
  ...process.env,
  PLAYWRIGHT_SERVER_HOST: serverHost,
  PLAYWRIGHT_SERVER_PORT: String(serverPort),
  VITE_OPENCODE_SERVER_HOST: serverHost,
  VITE_OPENCODE_SERVER_PORT: String(serverPort),
  PLAYWRIGHT_PORT: String(webPort),
} satisfies Record<string, string>

const seed = Bun.spawn(["bun", "script/seed-e2e.ts"], {
  cwd: opencodeDir,
  env: serverEnv,
  stdout: "inherit",
  stderr: "inherit",
})

const seedExit = await seed.exited
if (seedExit !== 0) {
  console.error(`[e2e] Seed process failed with exit code ${seedExit}`)
  process.exit(seedExit)
}
console.log(`[e2e] Seed completed successfully`)

// On Windows, add a small delay to ensure file handles are released
if (isWindows) {
  console.log(`[e2e] Waiting for Windows file handles to be released...`)
  await new Promise((r) => setTimeout(r, 1000))
}

console.log(`[e2e] Starting server on ${serverHost}:${serverPort}...`)

// Run the serve command directly instead of through `bun dev` for better Windows compatibility
const server = Bun.spawn(
  [
    "bun",
    "run",
    "--conditions=browser",
    "./src/index.ts",
    "--print-logs",
    "--log-level",
    "INFO", // Use INFO level for better debugging
    "serve",
    "--port",
    String(serverPort),
    "--hostname",
    serverHost,
  ],
  {
    cwd: opencodeDir,
    env: serverEnv,
    stdout: "inherit",
    stderr: "inherit",
  },
)

console.log(`[e2e] Server process spawned with PID ${server.pid}`)

try {
  const healthUrl = `http://${serverHost}:${serverPort}/global/health`
  console.log(`[e2e] Waiting for server health at ${healthUrl}`)
  await waitForHealth(healthUrl, server)

  console.log(`[e2e] Server is healthy, starting Playwright tests...`)
  const runner = Bun.spawn(["bun", "test:e2e", ...extraArgs], {
    cwd: appDir,
    env: runnerEnv,
    stdout: "inherit",
    stderr: "inherit",
  })

  process.exitCode = await runner.exited
  console.log(`[e2e] Tests completed with exit code ${process.exitCode}`)
} catch (error) {
  console.error(`[e2e] Error: ${error}`)
  // Try to get any output from the server process
  if (server.exitCode !== null) {
    console.error(`[e2e] Server exited with code ${server.exitCode}`)
  }
  throw error
} finally {
  console.log(`[e2e] Stopping server...`)
  server.kill()
}
