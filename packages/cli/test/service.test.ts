import { NodeFileSystem } from "@effect/platform-node"
import { Service, type Info } from "@opencode-ai/client/effect/service"
import { Global } from "@opencode-ai/util/global"
import { OPENCODE_VERSION } from "../src/version"
import { expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ServiceConfig } from "../src/services/service-config"
import { ServiceLifecycle } from "../src/services/service-lifecycle"

test("managed service ports are stable per installation channel", () => {
  expect(ServiceConfig.defaultPort("latest")).toBe(0xc0de)
  expect(ServiceConfig.defaultPort("next")).toBe(0xc0de)
  expect(ServiceConfig.defaultPort("local")).toBe(0xc0df)
  expect(ServiceConfig.defaultPort("preview-a")).toBe(ServiceConfig.defaultPort("preview-a"))
  expect(ServiceConfig.defaultPort("preview-a")).not.toBe(ServiceConfig.defaultPort("preview-b"))
})

test("local channel stores service config with the local service filename", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-"))
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* ServiceConfig.set("hostname", "127.0.0.2")
        yield* ServiceConfig.set("advertised-urls", "https://shuvdev.example:10001,http://127.0.0.1:4096")
      }).pipe(
        Effect.provide(Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })),
        Effect.provide(NodeFileSystem.layer),
      ),
    )
    expect(await Bun.file(path.join(root, "config", "service-local.json")).json()).toEqual({
      hostname: "127.0.0.2",
      advertisedUrls: ["https://shuvdev.example:10001", "http://127.0.0.1:4096"],
    })
    expect(await Bun.file(path.join(root, "config", "service.json")).exists()).toBe(false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("systemd service manager changes automatic startup command", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-manager-"))
  const layer = Layer.merge(
    Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") }),
    NodeFileSystem.layer,
  )
  try {
    await Effect.runPromise(ServiceConfig.set("manager", "systemd").pipe(Effect.provide(layer)))
    expect(await Effect.runPromise(ServiceConfig.get("manager").pipe(Effect.provide(layer)))).toBe("systemd")
    expect((await Effect.runPromise(ServiceConfig.options().pipe(Effect.provide(layer)))).command).toEqual([
      process.env.OPENCODE_SYSTEMCTL ?? "systemctl",
      "--user",
      "start",
      "shuvcode.service",
    ])
    expect(await Bun.file(path.join(root, "config", "service-local.json")).json()).toEqual({ manager: "systemd" })

    await Effect.runPromise(ServiceConfig.unset("manager").pipe(Effect.provide(layer)))
    expect(await Effect.runPromise(ServiceConfig.get("manager").pipe(Effect.provide(layer)))).toBe("")
    const portable = (await Effect.runPromise(ServiceConfig.options().pipe(Effect.provide(layer)))).command
    expect(portable[0]).toBe(process.execPath)
    expect(portable.slice(-2)).toEqual(["serve", "--service"])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("systemd lifecycle delegates stop and status to the configured user unit", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-systemd-"))
  const executable = path.join(root, "systemctl")
  const log = path.join(root, "systemctl.log")
  const previous = process.env.OPENCODE_SYSTEMCTL
  const previousLog = process.env.OPENCODE_SYSTEMCTL_LOG
  const layer = Layer.merge(
    Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") }),
    NodeFileSystem.layer,
  )
  try {
    await fs.mkdir(path.join(root, "config"), { recursive: true })
    await fs.writeFile(path.join(root, "config", "service-local.json"), JSON.stringify({ manager: "systemd" }))
    await fs.writeFile(
      executable,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "$OPENCODE_SYSTEMCTL_LOG"\ncase "$*" in\n  *is-active*) exit 3 ;;\nesac\n`,
      { mode: 0o755 },
    )
    process.env.OPENCODE_SYSTEMCTL = executable
    process.env.OPENCODE_SYSTEMCTL_LOG = log

    await Effect.runPromise(ServiceLifecycle.stop().pipe(Effect.provide(layer)))
    expect(await Effect.runPromise(ServiceLifecycle.status().pipe(Effect.provide(layer)))).toBeUndefined()
    expect((await Bun.file(log).text()).trim().split("\n")).toEqual([
      "--user stop shuvcode.service",
      "--user is-active --quiet shuvcode.service",
    ])
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_SYSTEMCTL
    else process.env.OPENCODE_SYSTEMCTL = previous
    if (previousLog === undefined) delete process.env.OPENCODE_SYSTEMCTL_LOG
    else process.env.OPENCODE_SYSTEMCTL_LOG = previousLog
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("systemd ensure replaces a portable incumbent with a supervised owner", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-systemd-converge-"))
  const executable = path.join(root, "systemctl")
  const pidfile = path.join(root, "systemd.pid")
  const port = await availablePort()
  const config = path.join(root, "config", "opencode")
  const state = path.join(root, "state", "opencode")
  const registration = path.join(state, "service-local.json")
  const previous = process.env.OPENCODE_SYSTEMCTL
  const layer = Layer.merge(Global.layerWith({ config, state }), NodeFileSystem.layer)
  const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`
  await fs.mkdir(config, { recursive: true })
  await fs.writeFile(path.join(config, "service-local.json"), JSON.stringify({ manager: "systemd", port }))
  await fs.writeFile(
    executable,
    `#!/bin/sh
set -eu
pidfile=${quote(pidfile)}
start_service() {
  if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then return; fi
  env HOME=${quote(root)} OPENCODE_DB=${quote(path.join(root, "opencode.db"))} OPENCODE_TEST_HOME=${quote(root)} XDG_CACHE_HOME=${quote(path.join(root, "cache"))} XDG_CONFIG_HOME=${quote(path.join(root, "config"))} XDG_DATA_HOME=${quote(path.join(root, "data"))} XDG_STATE_HOME=${quote(path.join(root, "state"))} ${quote(process.execPath)} ${quote(path.join(import.meta.dir, "../src/index.ts"))} serve --service >/dev/null 2>&1 &
  echo $! > "$pidfile"
}
stop_service() {
  if [ ! -f "$pidfile" ]; then return; fi
  pid=$(cat "$pidfile")
  kill "$pid" 2>/dev/null || true
  i=0
  while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 100 ]; do i=$((i + 1)); sleep 0.05; done
  rm -f "$pidfile"
}
case "$2" in
  is-active) if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then exit 0; fi; exit 3 ;;
  show) cat "$pidfile" ;;
  start) start_service ;;
  stop) stop_service ;;
  restart) stop_service; start_service ;;
esac
`,
    { mode: 0o755 },
  )
  process.env.OPENCODE_SYSTEMCTL = executable
  const incumbent = Bun.spawn([process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service"], {
    env: serviceEnv(root),
    stderr: "pipe",
    stdout: "ignore",
  })
  try {
    const before = await waitForInfo(registration)
    expect(before.pid).toBe(incumbent.pid)

    const endpoint = await Effect.runPromise(ServiceLifecycle.ensure().pipe(Effect.provide(layer)))
    const after = await waitForInfo(registration, (info) => info.pid !== before.pid)
    expect(endpoint.url).toBe(after.url)
    expect(after.pid).toBe(Number((await Bun.file(pidfile).text()).trim()))
    expect(await waitForExit(incumbent)).toBe(true)
  } finally {
    await Effect.runPromise(ServiceLifecycle.stop().pipe(Effect.provide(layer))).catch(() => undefined)
    incumbent.kill("SIGTERM")
    await incumbent.exited
    if (previous === undefined) delete process.env.OPENCODE_SYSTEMCTL
    else process.env.OPENCODE_SYSTEMCTL = previous
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)

test("systemd status requires the unit process tree to own registration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-systemd-owner-"))
  const executable = path.join(root, "systemctl")
  const previous = process.env.OPENCODE_SYSTEMCTL
  const previousPID = process.env.OPENCODE_SYSTEMCTL_PID
  const layer = Layer.merge(
    Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") }),
    NodeFileSystem.layer,
  )
  const server = Bun.serve({
    port: 0,
    fetch: () => Response.json({ healthy: true, version: OPENCODE_VERSION, pid: process.pid }),
  })
  try {
    await fs.mkdir(path.join(root, "config"), { recursive: true })
    await fs.mkdir(path.join(root, "state"), { recursive: true })
    await fs.writeFile(path.join(root, "config", "service-local.json"), JSON.stringify({ manager: "systemd" }))
    await fs.writeFile(
      path.join(root, "state", "service-local.json"),
      JSON.stringify({ id: "owned", version: OPENCODE_VERSION, url: server.url.toString(), pid: process.pid }),
    )
    await fs.writeFile(
      executable,
      `#!/bin/sh\ncase "$*" in\n  *is-active*) exit 0 ;;\n  *MainPID*) printf '%s\\n' "$OPENCODE_SYSTEMCTL_PID"; exit 0 ;;\nesac\nexit 1\n`,
      { mode: 0o755 },
    )
    process.env.OPENCODE_SYSTEMCTL = executable
    process.env.OPENCODE_SYSTEMCTL_PID = String(process.ppid)

    expect((await Effect.runPromise(ServiceLifecycle.status().pipe(Effect.provide(layer))))?.url).toBe(
      server.url.toString(),
    )
    process.env.OPENCODE_SYSTEMCTL_PID = "2147483647"
    expect(await Effect.runPromise(ServiceLifecycle.status().pipe(Effect.provide(layer)))).toBeUndefined()
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_SYSTEMCTL
    else process.env.OPENCODE_SYSTEMCTL = previous
    if (previousPID === undefined) delete process.env.OPENCODE_SYSTEMCTL_PID
    else process.env.OPENCODE_SYSTEMCTL_PID = previousPID
    await server.stop(true)
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("service manager rejects unsupported values", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-manager-invalid-"))
  try {
    const result = await Effect.runPromiseExit(
      ServiceConfig.set("manager", "launchd").pipe(
        Effect.provide(Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })),
        Effect.provide(NodeFileSystem.layer),
      ),
    )
    expect(result._tag).toBe("Failure")
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("service filenames share release channels and identify preview channels", () => {
  expect(ServiceConfig.filename("latest")).toBe("service.json")
  expect(ServiceConfig.filename("next")).toBe("service.json")
  expect(ServiceConfig.filename("local")).toBe("service-local.json")
  expect(ServiceConfig.filename("preview-a")).toBe("service-preview-a.json")
  expect(ServiceConfig.filename("preview/a")).toBe("service-preview-a.json")
  expect(ServiceConfig.versionBelongsToChannel("0.0.0-preview-a-1234", "preview-a")).toBe(true)
  expect(ServiceConfig.versionBelongsToChannel("0.0.0-preview-a-1234.2", "preview-a")).toBe(true)
  expect(ServiceConfig.versionBelongsToChannel("0.0.0-preview-a-other-1234", "preview-a")).toBe(false)
  expect(ServiceConfig.versionBelongsToChannel("1.2.3", "preview-a")).toBe(false)
})

test("service config migrates from the hashed channel filename", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-config-migration-"))
  const legacy = path.join(root, ServiceConfig.legacyFilename("preview-a")!)
  const target = path.join(root, ServiceConfig.filename("preview-a"))
  try {
    await fs.writeFile(legacy, JSON.stringify({ hostname: "127.0.0.2", port: 4098 }))
    await Effect.runPromise(ServiceConfig.migrateConfig(legacy, target).pipe(Effect.provide(NodeFileSystem.layer)))
    expect(await Bun.file(target).json()).toEqual({ hostname: "127.0.0.2", port: 4098 })

    await fs.writeFile(target, JSON.stringify({ port: 4099 }))
    await Effect.runPromise(ServiceConfig.migrateConfig(legacy, target).pipe(Effect.provide(NodeFileSystem.layer)))
    expect(await Bun.file(target).json()).toEqual({ port: 4099 })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("preview registration migration never moves stable discovery", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-migration-"))
  const legacy = path.join(root, "service.json")
  const target = path.join(root, ServiceConfig.filename("preview-a"))
  try {
    await fs.writeFile(
      legacy,
      JSON.stringify({ id: "old-preview", version: "0.0.0-preview-a-1234", url: "http://localhost:4096", pid: 1 }),
    )
    await Effect.runPromise(
      ServiceConfig.migrateRegistration(legacy, target, "preview-a", "0.0.0-preview-a-5678").pipe(
        Effect.provide(NodeFileSystem.layer),
      ),
    )
    expect(await Bun.file(legacy).exists()).toBe(true)
    expect(await Bun.file(target).json()).toMatchObject({ id: "old-preview" })

    await fs.rm(target)
    await fs.writeFile(legacy, JSON.stringify({ id: "stable", version: "1.2.3", url: "http://localhost:4096", pid: 1 }))
    await Effect.runPromise(
      ServiceConfig.migrateRegistration(legacy, target, "preview-a", "0.0.0-preview-a-5678").pipe(
        Effect.provide(NodeFileSystem.layer),
      ),
    )
    expect(await Bun.file(legacy).exists()).toBe(true)
    expect(await Bun.file(target).exists()).toBe(false)

    await fs.writeFile(
      legacy,
      JSON.stringify({ id: "old-preview", version: "0.0.0-preview-a-1234", url: "http://localhost:4096", pid: 1 }),
    )
    await fs.writeFile(target, JSON.stringify({ id: "current-preview" }))
    await Effect.runPromise(
      ServiceConfig.migrateRegistration(legacy, target, "preview-a", "0.0.0-preview-a-5678").pipe(
        Effect.provide(NodeFileSystem.layer),
      ),
    )
    expect(await Bun.file(legacy).exists()).toBe(true)
    expect(await Bun.file(target).json()).toMatchObject({ id: "current-preview" })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("managed service writes its registration once", async () => {
  const service = await startManagedService("opencode-service-once-")
  try {
    const before = await fs.stat(service.registration)
    await Bun.sleep(6_000)
    const after = await fs.stat(service.registration)
    expect(after.ino).toBe(before.ino)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(await Bun.file(service.registration).json()).toEqual(service.info)
  } finally {
    await stopManagedService(service)
  }
}, 30_000)

test("deleting a managed service registration stops its owner", async () => {
  const service = await startManagedService("opencode-service-delete-")
  try {
    await fs.rm(service.registration)
    expect(await waitForExit(service.owner)).toBe(true)
    expect(await Bun.file(service.registration).exists()).toBe(false)
    await expectPortAvailable(service.port)
  } finally {
    await stopManagedService(service)
  }
}, 30_000)

test("deleting a failed service registration stops its owner", async () => {
  const service = await startManagedService("opencode-service-failed-delete-", true)
  try {
    await waitForFailed(service.info)
    await fs.rm(service.registration)
    expect(await waitForExit(service.owner)).toBe(true)
    await expectPortAvailable(service.port)
  } finally {
    await stopManagedService(service)
  }
}, 30_000)

test("corrupting a managed service registration stops its owner", async () => {
  const service = await startManagedService("opencode-service-corrupt-")
  try {
    await fs.writeFile(service.registration, "not-json")
    expect(await waitForExit(service.owner)).toBe(true)
    expect(await Bun.file(service.registration).text()).toBe("not-json")
    await expectPortAvailable(service.port)
  } finally {
    await stopManagedService(service)
  }
}, 30_000)

test("replacing a managed service registration stops its owner and preserves the foreign owner", async () => {
  const service = await startManagedService("opencode-service-foreign-")
  const foreign = { ...service.info, id: "foreign-owner", pid: process.pid }
  try {
    await fs.writeFile(service.registration, JSON.stringify(foreign))
    expect(await waitForExit(service.owner)).toBe(true)
    expect(await Bun.file(service.registration).json()).toEqual(foreign)
    await expectPortAvailable(service.port)
  } finally {
    await stopManagedService(service)
  }
}, 30_000)

test("clean managed service shutdown removes its registration", async () => {
  const service = await startManagedService("opencode-service-clean-")
  try {
    await Effect.runPromise(Service.stop({ file: service.registration }).pipe(Effect.provide(NodeFileSystem.layer)))
    expect(await waitForExit(service.owner)).toBe(true)
    expect(await Bun.file(service.registration).exists()).toBe(false)
  } finally {
    await stopManagedService(service)
  }
}, 30_000)

test("concurrent service processes elect one server", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-election-"))
  const database = path.join(root, "opencode.db")
  const env = {
    ...process.env,
    HOME: root,
    OPENCODE_DB: database,
    OPENCODE_TEST_HOME: root,
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_STATE_HOME: path.join(root, "state"),
  }
  const command = [process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service"]
  const registration = path.join(root, "state", "opencode", "service-local.json")
  const port = await availablePort()
  const config = path.join(root, "config", "opencode", "service-local.json")
  await fs.mkdir(path.join(root, "config", "opencode"), { recursive: true })
  await fs.writeFile(config, JSON.stringify({ port }))
  const processes = Array.from({ length: 10 }, () => Bun.spawn(command, { env, stderr: "pipe", stdout: "pipe" }))

  try {
    const info = await waitForInfo(registration)
    const winner = processes.find((process) => process.pid === info.pid)
    const losers = processes.filter((process) => process.pid !== info.pid)
    const exited = await Promise.all(
      losers.map((process) => Promise.race([process.exited.then(() => true), Bun.sleep(60_000).then(() => false)])),
    )

    expect(exited).toEqual(losers.map(() => true))
    const errors = await Promise.all(
      losers.map(
        async (process) => (await new Response(process.stdout).text()) + (await new Response(process.stderr).text()),
      ),
    )
    expect(
      losers.map((process) => process.exitCode),
      errors.filter(Boolean).join("\n"),
    ).toEqual(losers.map(() => 0))
    expect(winner?.exitCode).toBe(null)
    expect(new URL(info.url).port).toBe(String(port))
    expect((await Bun.file(config).json()).password).toBe(info.password)
    expect(await Bun.file(registration + ".lock").exists()).toBe(false)
    expect(
      await fetch(new URL("/api/health", info.url), {
        headers: { authorization: "Basic " + btoa(`opencode:${info.password}`) },
      }).then((response) => response.json()),
    ).toEqual({
      healthy: true,
      version: info.version,
      pid: info.pid,
    })
    const contender = Bun.spawn(command, { env, stderr: "pipe", stdout: "ignore" })
    try {
      const contenderExited = await Promise.race([
        contender.exited.then(() => true),
        Bun.sleep(10_000).then(() => false),
      ])
      expect(contenderExited).toBe(true)
      expect(contender.exitCode).toBe(0)
      expect((await waitForInfo(registration)).id).toBe(info.id)
    } finally {
      contender.kill("SIGTERM")
      await contender.exited
    }
    await Effect.runPromise(Service.stop({ file: registration }).pipe(Effect.provide(NodeFileSystem.layer)))
    await winner?.exited
    expect(await Bun.file(registration).exists()).toBe(false)
  } finally {
    processes.forEach((process) => process.kill("SIGTERM"))
    await Promise.all(processes.map((process) => process.exited))
    await fs.rm(root, { recursive: true, force: true })
  }
}, 120_000)

test("configured managed service port overrides the channel default", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-port-"))
  const port = await availablePort()
  const env = serviceEnv(root)
  const registration = path.join(root, "state", "opencode", "service-local.json")
  const config = path.join(root, "config", "opencode", "service-local.json")
  await fs.mkdir(path.join(root, "config", "opencode"), { recursive: true })
  await fs.writeFile(config, JSON.stringify({ port, password: "" }))
  const owner = Bun.spawn([process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service"], {
    env,
    stderr: "pipe",
    stdout: "ignore",
  })
  try {
    const info = await waitForInfo(registration)
    expect(new URL(info.url).port).toBe(String(port))
    expect(info.password).not.toBe("")
    expect((await Bun.file(config).json()).password).toBe(info.password)
    await Effect.runPromise(Service.stop({ file: registration }).pipe(Effect.provide(NodeFileSystem.layer)))
    await owner.exited
  } finally {
    owner.kill("SIGTERM")
    await owner.exited
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)

test("unrelated managed port occupancy reports an actionable conflict", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-conflict-"))
  const listener = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("unrelated") })
  const port = listener.port
  const registration = path.join(root, "state", "opencode", "service-local.json")
  await fs.mkdir(path.join(root, "config", "opencode"), { recursive: true })
  await fs.writeFile(path.join(root, "config", "opencode", "service-local.json"), JSON.stringify({ port }))
  const contender = Bun.spawn([process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service"], {
    env: serviceEnv(root),
    stderr: "pipe",
    stdout: "pipe",
  })
  try {
    expect(await contender.exited).not.toBe(0)
    const output = (await new Response(contender.stdout).text()) + (await new Response(contender.stderr).text())
    expect(output).toContain(`Managed service port ${port} on 127.0.0.1 is already in use by another process`)
    expect(output).toContain("shuvcode service set port <port>")
    expect(await Bun.file(registration).exists()).toBe(false)
  } finally {
    listener.stop(true)
    contender.kill("SIGTERM")
    await contender.exited
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)

test("unresponsive managed port occupancy reports a bounded conflict", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-unresponsive-conflict-"))
  const recognizing = Promise.withResolvers<void>()
  const requests = { count: 0 }
  using listener = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      requests.count += 1
      if (requests.count === 2) recognizing.resolve()
      return new Promise<Response>(() => {})
    },
  })
  const registration = path.join(root, "state", "opencode", "service-local.json")
  await fs.mkdir(path.join(root, "config", "opencode"), { recursive: true })
  await fs.mkdir(path.dirname(registration), { recursive: true })
  await fs.writeFile(
    path.join(root, "config", "opencode", "service-local.json"),
    JSON.stringify({ port: listener.port }),
  )
  const stale = {
    id: "stale",
    version: OPENCODE_VERSION,
    url: "http://127.0.0.1:1",
    pid: process.pid,
    password: "stale",
  }
  await fs.writeFile(registration, JSON.stringify(stale))
  const contender = Bun.spawn([process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service"], {
    env: serviceEnv(root),
    stderr: "pipe",
    stdout: "pipe",
  })

  try {
    expect(await Promise.race([recognizing.promise.then(() => true), Bun.sleep(20_000).then(() => false)])).toBe(true)
    const exitCode = await Promise.race([contender.exited, Bun.sleep(20_000).then(() => undefined)])
    expect(exitCode).toBe(1)
    const output = (await new Response(contender.stdout).text()) + (await new Response(contender.stderr).text())
    expect(output).toContain(`Managed service port ${listener.port} on 127.0.0.1 is already in use by another process`)
    expect(await Bun.file(registration).json()).toEqual(stale)
  } finally {
    contender.kill("SIGTERM")
    await contender.exited
    await fs.rm(root, { recursive: true, force: true })
  }
}, 45_000)

test("port contender recognizes an incumbent registered during the bind race", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-bind-race-"))
  const recognizing = Promise.withResolvers<void>()
  const requests = { count: 0 }
  using listener = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      requests.count += 1
      if (requests.count === 2) recognizing.resolve()
      return Response.json({ healthy: true, version: OPENCODE_VERSION, pid: process.pid }, { status: 503 })
    },
  })
  const registration = path.join(root, "state", "opencode", "service-local.json")
  const config = path.join(root, "config", "opencode", "service-local.json")
  await fs.mkdir(path.dirname(config), { recursive: true })
  await fs.writeFile(config, JSON.stringify({ port: listener.port }))
  await fs.mkdir(path.dirname(registration), { recursive: true })
  await fs.writeFile(
    registration,
    JSON.stringify({
      id: "stale",
      version: OPENCODE_VERSION,
      url: "http://127.0.0.1:1",
      pid: 2_147_483_647,
      password: "stale",
    }),
  )
  const contender = Bun.spawn([process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service"], {
    env: serviceEnv(root),
    stderr: "pipe",
    stdout: "ignore",
  })

  try {
    expect(await Promise.race([recognizing.promise.then(() => true), Bun.sleep(20_000).then(() => false)])).toBe(true)
    await Bun.sleep(8_000)
    const info = {
      id: "incumbent",
      version: OPENCODE_VERSION,
      url: `http://127.0.0.1:${listener.port}`,
      pid: process.pid,
      password: "incumbent",
    }
    await fs.writeFile(registration, JSON.stringify(info))

    expect(await Promise.race([contender.exited, Bun.sleep(20_000).then(() => undefined)])).toBe(0)
    expect(await Bun.file(registration).json()).toEqual(info)
  } finally {
    contender.kill("SIGTERM")
    await contender.exited
    await fs.rm(root, { recursive: true, force: true })
  }
}, 45_000)

test("stale dead registration is replaced after binding the selected port", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-stale-"))
  const port = await availablePort()
  const registration = path.join(root, "state", "opencode", "service-local.json")
  await fs.mkdir(path.join(root, "config", "opencode"), { recursive: true })
  await fs.mkdir(path.dirname(registration), { recursive: true })
  await fs.writeFile(path.join(root, "config", "opencode", "service-local.json"), JSON.stringify({ port }))
  await fs.writeFile(
    registration,
    JSON.stringify({ id: "dead", version: "dead", url: `http://127.0.0.1:${port}`, pid: 2_147_483_647 }),
  )
  const owner = Bun.spawn([process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service"], {
    env: serviceEnv(root),
    stderr: "pipe",
    stdout: "ignore",
  })
  try {
    const info = await waitForInfo(registration, (value) => value.id !== "dead")
    expect(new URL(info.url).port).toBe(String(port))
    expect(info.pid).toBe(owner.pid)
    await Effect.runPromise(Service.stop({ file: registration }).pipe(Effect.provide(NodeFileSystem.layer)))
    await owner.exited
  } finally {
    owner.kill("SIGTERM")
    await owner.exited
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)

test("a failed service stays registered and owns the selected port until stopped", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-failed-"))
  const database = path.join(root, "database")
  await fs.mkdir(database)
  const env = {
    ...process.env,
    HOME: root,
    OPENCODE_DB: database,
    OPENCODE_TEST_HOME: root,
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_STATE_HOME: path.join(root, "state"),
  }
  const command = [process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service"]
  const registration = path.join(root, "state", "opencode", "service-local.json")
  const owner = Bun.spawn(command, { env, stderr: "pipe", stdout: "ignore" })

  try {
    const info = await waitForInfo(registration)
    await waitForFailed(info)
    expect(owner.exitCode).toBe(null)

    const contender = Bun.spawn(command, { env, stderr: "pipe", stdout: "ignore" })
    expect(await Promise.race([contender.exited.then(() => true), Bun.sleep(10_000).then(() => false)])).toBe(true)
    expect(contender.exitCode).toBe(0)
    expect((await waitForInfo(registration)).id).toBe(info.id)
    expect(owner.exitCode).toBe(null)

    await Effect.runPromise(Service.stop({ file: registration }).pipe(Effect.provide(NodeFileSystem.layer)))
    await owner.exited
    expect(await Bun.file(registration).exists()).toBe(false)
  } finally {
    owner.kill("SIGTERM")
    await owner.exited
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)

async function waitForInfo(file: string, accept: (info: Info) => boolean = () => true) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const value = await Bun.file(file)
      .json()
      .catch(() => undefined)
    if (value !== undefined) {
      const info = await Schema.decodeUnknownPromise(Service.Info)(value)
      if (accept(info)) return info
    }
    await Bun.sleep(50)
  }
  throw new Error("Timed out waiting for service registration")
}

async function waitForFailed(info: Info) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const status = await fetch(new URL("/api/health", info.url), {
      headers: { authorization: "Basic " + btoa(`opencode:${info.password}`) },
    })
      .then((response) => response.status)
      .catch(() => undefined)
    if (status === 500) return
    await Bun.sleep(50)
  }
  throw new Error("Timed out waiting for service boot failure")
}

async function availablePort() {
  const server = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = server.port
  await server.stop(true)
  if (port === undefined) throw new Error("Server did not bind a port")
  return port
}

function serviceEnv(root: string) {
  return {
    ...process.env,
    HOME: root,
    OPENCODE_DB: path.join(root, "opencode.db"),
    OPENCODE_TEST_HOME: root,
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_STATE_HOME: path.join(root, "state"),
  }
}

async function startManagedService(prefix: string, failBoot = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  const port = await availablePort()
  const registration = path.join(root, "state", "opencode", "service-local.json")
  await fs.mkdir(path.join(root, "config", "opencode"), { recursive: true })
  if (failBoot) await fs.mkdir(path.join(root, "database"))
  await fs.writeFile(path.join(root, "config", "opencode", "service-local.json"), JSON.stringify({ port }))
  const owner = Bun.spawn([process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service"], {
    env: failBoot ? { ...serviceEnv(root), OPENCODE_DB: path.join(root, "database") } : serviceEnv(root),
    stderr: "pipe",
    stdout: "ignore",
  })
  const info = await waitForInfo(registration).catch(async (cause) => {
    owner.kill("SIGTERM")
    await owner.exited
    await fs.rm(root, { recursive: true, force: true })
    throw cause
  })
  return { root, port, registration, owner, info }
}

async function stopManagedService(service: Awaited<ReturnType<typeof startManagedService>>) {
  service.owner.kill("SIGTERM")
  await service.owner.exited
  await fs.rm(service.root, { recursive: true, force: true })
}

function waitForExit(process: Bun.Subprocess, timeout = 10_000) {
  return Promise.race([process.exited.then(() => true), Bun.sleep(timeout).then(() => false)])
}

async function expectPortAvailable(port: number) {
  const server = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response() })
  await server.stop(true)
}
