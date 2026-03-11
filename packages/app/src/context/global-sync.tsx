import type {
  Config,
  OpencodeClient,
  Path,
  Project,
  ProviderAuthResponse,
  ProviderListResponse,
  Todo,
} from "@opencode-ai/sdk/v2/client"
import { createStore, produce, reconcile } from "solid-js/store"
import { useGlobalSDK } from "./global-sdk"
import { ErrorPage, type InitError } from "../pages/error"
import { WelcomeScreen } from "../components/welcome-screen"
import { showToast } from "@opencode-ai/ui/toast"
import { getFilename } from "@opencode-ai/util/path"
import {
  createContext,
  createEffect,
  getOwner,
  Match,
  onCleanup,
  onMount,
  type ParentProps,
  Switch,
  untrack,
  useContext,
} from "solid-js"
import { retry } from "@opencode-ai/util/retry"
import { isHostedEnvironment } from "@/utils/hosted"
import { useLanguage } from "@/context/language"
import { Persist, persisted } from "@/utils/persist"
import { bootstrapDirectory, bootstrapGlobal } from "./global-sync/bootstrap"
import { cmp, normalizeProviderList, sanitizeProject } from "./global-sync/utils"
import { createChildStoreManager } from "./global-sync/child-store"
import { applyDirectoryEvent, applyGlobalEvent } from "./global-sync/event-reducer"
import { createRefreshQueue } from "./global-sync/queue"
import { estimateRootSessionTotal, loadRootSessionsWithFallback } from "./global-sync/session-load"
import { trimSessions } from "./global-sync/session-trim"
import type { ProjectMeta } from "./global-sync/types"
import { SESSION_RECENT_LIMIT } from "./global-sync/types"
import { usePlatform } from "./platform"

type ConnectionState = "connecting" | "ready" | "needs_config" | "error"

type GlobalStore = {
  connectionState: ConnectionState
  ready: boolean
  error?: InitError
  attemptedUrl?: string
  path: Path
  project: Project[]
  session_todo: {
    [sessionID: string]: Todo[]
  }
  provider: ProviderListResponse
  provider_auth: ProviderAuthResponse
  config: Config
  reload: undefined | "pending" | "complete"
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  return "Unknown error"
}

function createGlobalSync() {
  const globalSDK = useGlobalSDK()
  const platform = usePlatform()
  const language = useLanguage()
  const owner = getOwner()
  if (!owner) throw new Error("GlobalSync must be created within owner")

  const sdkCache = new Map<string, OpencodeClient>()
  const booting = new Map<string, Promise<void>>()
  const sessionLoads = new Map<string, Promise<void>>()
  const sessionMeta = new Map<string, { limit: number }>()

  const [projectCache, setProjectCache, , projectCacheReady] = persisted(
    Persist.global("globalSync.project", ["globalSync.project.v1"]),
    createStore({ value: [] as Project[] }),
  )

  const [globalStore, setGlobalStore] = createStore<GlobalStore>({
    connectionState: "connecting",
    ready: false,
    attemptedUrl: undefined,
    path: { state: "", config: "", worktree: "", directory: "", home: "" },
    project: projectCache.value,
    session_todo: {},
    provider: { all: [], connected: [], default: {} },
    provider_auth: {},
    config: {},
    reload: undefined,
  })

  const setSessionTodo = (sessionID: string, todos: Todo[] | undefined) => {
    if (!sessionID) return
    if (!todos) {
      setGlobalStore(
        "session_todo",
        produce((draft) => {
          delete draft[sessionID]
        }),
      )
      return
    }
    setGlobalStore("session_todo", sessionID, reconcile(todos, { key: "id" }))
  }

  const paused = () => untrack(() => globalStore.reload) !== undefined

  const queue = createRefreshQueue({
    paused,
    bootstrap,
    bootstrapInstance,
  })

  const children = createChildStoreManager({
    owner,
    isBooting: (directory) => booting.has(directory),
    isLoadingSessions: (directory) => sessionLoads.has(directory),
    onBootstrap: (directory) => {
      void bootstrapInstance(directory)
    },
    onDispose: (directory) => {
      queue.clear(directory)
      sessionMeta.delete(directory)
      sdkCache.delete(directory)
    },
  })

  const sdkFor = (directory: string) => {
    const cached = sdkCache.get(directory)
    if (cached) return cached
    const sdk = globalSDK.createClient({
      directory,
      throwOnError: true,
    })
    sdkCache.set(directory, sdk)
    return sdk
  }

  createEffect(() => {
    if (!projectCacheReady()) return
    if (globalStore.project.length !== 0) return
    const cached = projectCache.value
    if (cached.length === 0) return
    setGlobalStore("project", cached)
  })

  createEffect(() => {
    if (!projectCacheReady()) return
    const projects = globalStore.project
    if (projects.length === 0) {
      const cachedLength = untrack(() => projectCache.value.length)
      if (cachedLength !== 0) return
    }
    setProjectCache("value", projects.map(sanitizeProject))
  })

  createEffect(() => {
    if (globalStore.reload !== "complete") return
    setGlobalStore("reload", undefined)
    queue.refresh()
  })

  async function loadSessions(directory: string) {
    const pending = sessionLoads.get(directory)
    if (pending) return pending

    children.pin(directory)
    const [store, setStore] = children.child(directory, { bootstrap: false })
    const meta = sessionMeta.get(directory)
    if (meta && meta.limit >= store.limit) {
      const next = trimSessions(store.session, {
        limit: store.limit,
        permission: store.permission,
      })
      if (next.length !== store.session.length) {
        setStore("session", reconcile(next, { key: "id" }))
      }
      children.unpin(directory)
      return
    }

    const limit = Math.max(store.limit + SESSION_RECENT_LIMIT, SESSION_RECENT_LIMIT)
    const promise = loadRootSessionsWithFallback({
      directory,
      limit,
      list: (query) => globalSDK.client.session.list(query),
    })
      .then((x) => {
        const data = Array.isArray(x.data) ? x.data : []
        const nonArchived = data
          .filter((s) => !!s?.id)
          .filter((s) => !s.time?.archived)
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        const limit = store.limit
        const childSessions = store.session.filter((s) => !!s.parentID)
        const sessions = trimSessions([...nonArchived, ...childSessions], {
          limit,
          permission: store.permission,
        })
        setStore(
          "sessionTotal",
          estimateRootSessionTotal({
            count: nonArchived.length,
            limit: x.limit,
            limited: x.limited,
          }),
        )
        setStore("session", reconcile(sessions, { key: "id" }))
        sessionMeta.set(directory, { limit })
      })
      .catch((err) => {
        console.error("Failed to load sessions", err)
        const project = getFilename(directory)
        showToast({
          title: language.t("toast.session.listFailed.title", { project }),
          description: errorMessage(err),
        })
      })

    sessionLoads.set(directory, promise)
    promise.finally(() => {
      sessionLoads.delete(directory)
      children.unpin(directory)
    })
    return promise
  }

  async function bootstrapInstance(directory: string) {
    if (!directory) return
    const pending = booting.get(directory)
    if (pending) return pending

    children.pin(directory)
    const promise = (async () => {
      const child = children.ensureChild(directory)
      const cache = children.vcsCache.get(directory)
      if (!cache) return
      const sdk = sdkFor(directory)
      await bootstrapDirectory({
        directory,
        sdk,
        store: child[0],
        setStore: child[1],
        vcsCache: cache,
        loadSessions,
        translate: language.t,
      })
    })()

    booting.set(directory, promise)
    promise.finally(() => {
      booting.delete(directory)
      children.unpin(directory)
    })
    return promise
  }

  const unsub = globalSDK.event.listen((e) => {
    const directory = e.name
    const event = e.details

    if (directory === "global") {
      applyGlobalEvent({
        event,
        project: globalStore.project,
        refresh: queue.refresh,
        setGlobalProject(next) {
          if (typeof next === "function") {
            setGlobalStore("project", produce(next))
            return
          }
          setGlobalStore("project", next)
        },
      })
      if (event.type === "server.connected" || event.type === "global.disposed") {
        for (const directory of Object.keys(children.children)) {
          queue.push(directory)
        }
      }
      return
    }

    const existing = children.children[directory]
    if (!existing) return
    children.mark(directory)
    const [store, setStore] = existing
    applyDirectoryEvent({
      event,
      directory,
      store,
      setStore,
      push: queue.push,
      setSessionTodo,
      vcsCache: children.vcsCache.get(directory),
      loadLsp: () => {
        sdkFor(directory)
          .lsp.status()
          .then((x) => setStore("lsp", x.data ?? []))
      },
    })
  })

  onCleanup(unsub)
  onCleanup(() => {
    queue.dispose()
  })
  onCleanup(() => {
    for (const directory of Object.keys(children.children)) {
      children.disposeDirectory(directory)
    }
  })

  /**
   * Probes the server health with a short timeout (2 seconds).
   * Used for initial connection to provide quick feedback.
   */
  async function probeHealth(
    url: string,
    healthFn: () => Promise<{ data?: { healthy?: boolean } }>,
  ): Promise<{ healthy: boolean }> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 2000)

      const result = await healthFn()
      clearTimeout(timeoutId)

      return { healthy: result.data?.healthy === true }
    } catch {
      return { healthy: false }
    }
  }

  async function bootstrap() {
    setGlobalStore("connectionState", "connecting")
    setGlobalStore("attemptedUrl", globalSDK.url)

    // Use a short timeout for the health probe (2 seconds)
    const probeResult = await probeHealth(globalSDK.url, () => globalSDK.client.global.health())

    if (!probeResult.healthy) {
      // For hosted environments, show the welcome/configuration screen
      if (isHostedEnvironment()) {
        setGlobalStore("connectionState", "needs_config")
        return
      }
      // For non-hosted environments, show the error page
      setGlobalStore("error", new Error(language.t("error.globalSync.connectFailed", { url: globalSDK.url })))
      setGlobalStore("connectionState", "error")
      return
    }

    return Promise.all([
      retry(() =>
        globalSDK.client.path.get().then((x) => {
          setGlobalStore("path", x.data!)
        }),
      ),
      retry(() =>
        globalSDK.client.global.config.get().then((x) => {
          setGlobalStore("config", x.data!)
        }),
      ),
      retry(() =>
        globalSDK.client.project.list().then(async (x) => {
          const data = Array.isArray(x.data) ? x.data : []
          const projects = data
            .filter((p) => !!p?.id)
            .filter((p) => !!p.worktree && !p.worktree.includes("opencode-test"))
            .slice()
            .sort((a, b) => cmp(a.id, b.id))
          setGlobalStore("project", projects)
        }),
      ),
      retry(() =>
        globalSDK.client.provider.list().then((x) => {
          setGlobalStore("provider", normalizeProviderList(x.data!))
        }),
      ),
      retry(() =>
        globalSDK.client.provider.auth().then((x) => {
          setGlobalStore("provider_auth", x.data ?? {})
        }),
      ),
    ])
      .then(() => {
        setGlobalStore("ready", true)
        setGlobalStore("connectionState", "ready")
      })
      .catch((e) => {
        setGlobalStore("error", e)
        setGlobalStore("connectionState", "error")
      })
  }

  onMount(() => {
    void bootstrap()
  })

  const projectApi = {
    loadSessions,
    meta(directory: string, patch: ProjectMeta) {
      children.projectMeta(directory, patch)
    },
    icon(directory: string, value: string | undefined) {
      children.projectIcon(directory, value)
    },
  }

  const updateConfig = async (config: Config) => {
    setGlobalStore("reload", "pending")
    return globalSDK.client.global.config
      .update({ config })
      .then(bootstrap)
      .then(() => {
        setGlobalStore("reload", "complete")
      })
      .catch((error) => {
        setGlobalStore("reload", undefined)
        throw error
      })
  }

  return {
    data: globalStore,
    set: setGlobalStore,
    get ready() {
      return globalStore.ready
    },
    get error() {
      return globalStore.error
    },
    get connectionState() {
      return globalStore.connectionState
    },
    get attemptedUrl() {
      return globalStore.attemptedUrl
    },
    child: children.child,
    bootstrap,
    updateConfig,
    project: projectApi,
    todo: {
      set: setSessionTodo,
    },
  }
}

const GlobalSyncContext = createContext<ReturnType<typeof createGlobalSync>>()

export function GlobalSyncProvider(props: ParentProps) {
  const value = createGlobalSync()
  return (
    <Switch>
      <Match when={value.connectionState === "connecting"}>
        <div class="flex-1 h-screen w-screen min-h-0 flex flex-col items-center justify-center bg-background-base">
          <div class="text-text-weak text-sm">Connecting to server...</div>
        </div>
      </Match>
      <Match when={value.connectionState === "needs_config"}>
        <WelcomeScreen attemptedUrl={value.attemptedUrl} onRetry={() => value.bootstrap()} />
      </Match>
      <Match when={value.connectionState === "error"}>
        <ErrorPage error={value.error} />
      </Match>
      <Match when={value.connectionState === "ready"}>
        <GlobalSyncContext.Provider value={value}>{props.children}</GlobalSyncContext.Provider>
      </Match>
    </Switch>
  )
}

export function useGlobalSync() {
  const context = useContext(GlobalSyncContext)
  if (!context) throw new Error("useGlobalSync must be used within GlobalSyncProvider")
  return context
}

export { canDisposeDirectory, pickDirectoriesToEvict } from "./global-sync/eviction"
export { estimateRootSessionTotal, loadRootSessionsWithFallback } from "./global-sync/session-load"
