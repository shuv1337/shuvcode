import z from "zod/v4"
import path from "path"
import { Glob } from "bun"
import { Log } from "../util/log"
import { WebSocketClientTransport, McpError } from "../mcp/ws"
import { Config } from "../config/config"

const log = Log.create({ service: "ide" })

const WS_PREFIX = "ws://127.0.0.1"

const LockFile = {
  schema: z.object({
    port: z.number(),
    url: z.instanceof(URL),
    pid: z.number(),
    workspaceFolders: z.array(z.string()),
    ideName: z.string(),
    transport: z.string(),
    authToken: z.string(),
  }),
  async fromFile(file: string) {
    const port = parseInt(path.basename(file, ".lock"))
    const url = new URL(`${WS_PREFIX}:${port}`)
    const content = await Bun.file(file).text()
    const parsed = this.schema.safeParse({ port, url, ...JSON.parse(content) })
    if (!parsed.success) {
      log.warn("invalid lock file", { file, error: parsed.error })
      return undefined
    }
    return parsed.data
  },
}
type LockFile = z.infer<typeof LockFile.schema>

export async function discoverLockFiles(): Promise<Map<string, LockFile>> {
  const results = new Map<string, LockFile>()
  const config = await Config.get()

  if (!config.ide?.lockfile_dir) {
    log.debug("ide.lockfile_dir not configured, skipping IDE discovery")
    return results
  }

  const glob = new Glob("*.lock")
  for await (const file of glob.scan({ cwd: config.ide.lockfile_dir, absolute: true })) {
    const lockFile = await LockFile.fromFile(file)
    if (!lockFile) continue

    try {
      process.kill(lockFile.pid, 0)
    } catch {
      log.debug("stale lock file, process not running", { file, pid: lockFile.pid })
      continue
    }

    results.set(String(lockFile.port), lockFile)
  }

  return results
}

export class Connection {
  key: string
  name: string
  private transport: WebSocketClientTransport
  private requestId = 0
  private pendingRequests = new Map<string | number, PromiseWithResolvers<unknown>>()
  onNotification?: (method: string, params: unknown) => void
  onClose?: () => void

  private constructor(key: string, name: string, transport: WebSocketClientTransport) {
    this.key = key
    this.name = name
    this.transport = transport
  }

  static async create(key: string): Promise<Connection> {
    const config = await Config.get()
    if (!config.ide?.auth_header_name) {
      throw new Error("ide.auth_header_name is required in config")
    }

    const discovered = await discoverLockFiles()
    const lockFile = discovered.get(key)
    if (!lockFile) {
      throw new Error(`IDE instance not found: ${key}`)
    }

    const transport = new WebSocketClientTransport(lockFile.url, {
      headers: {
        [config.ide.auth_header_name]: lockFile.authToken,
      },
    })

    const connection = new Connection(key, lockFile.ideName, transport)

    transport.onmessage = (message) => {
      connection.handleMessage(message as any)
    }

    transport.onclose = () => {
      log.info("IDE transport closed", { key })
      connection.onClose?.()
    }

    transport.onerror = (err) => {
      log.error("IDE transport error", { key, error: err })
    }

    await transport.start()

    return connection
  }

  private handleMessage(payload: {
    id?: string | number
    method?: string
    params?: unknown
    result?: unknown
    error?: { code: number; message: string; data?: unknown }
  }) {
    // Handle responses to our requests
    const pending = payload.id !== undefined ? this.pendingRequests.get(payload.id) : undefined
    if (pending) {
      this.pendingRequests.delete(payload.id!)
      if (payload.error) {
        const { code, message, data } = payload.error
        // TODO put code in message on ws server.
        pending.reject(new McpError(code, `${message} (code: ${code})`, data))
      } else {
        pending.resolve(payload.result)
      }
      return
    }

    // Handle notifications
    if (payload.method) {
      this.onNotification?.(payload.method, payload.params)
    }
  }

  async request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = ++this.requestId
    const pending = Promise.withResolvers<T>()
    this.pendingRequests.set(id, pending as PromiseWithResolvers<unknown>)
    this.transport.send({
      jsonrpc: "2.0" as const,
      id,
      method: `tools/call`,
      params: {
        name: method,
        arguments: params ?? {},
      },
    })
    return pending.promise
  }

  async close() {
    await this.transport.close()
  }
}
