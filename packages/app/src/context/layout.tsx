import { createStore, produce } from "solid-js/store"
import { batch, createEffect, createMemo, onMount } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useGlobalSync } from "./global-sync"
import { useGlobalSDK } from "./global-sdk"
import { useServer } from "./server"
import { Project } from "@opencode-ai/sdk/v2"
import { persisted } from "@/utils/persist"
import { applyTheme, DEFAULT_THEME_ID } from "@/theme/apply-theme"
import { applyFontWithLoad } from "@/fonts/apply-font"
import { getFontById, FONTS } from "@/fonts/font-definitions"

export const REVIEW_PANE = {
  DEFAULT_WIDTH: 450,
  MIN_WIDTH: 200,
  MAX_WIDTH_RATIO: 0.5,
} as const

const AVATAR_COLOR_KEYS = ["pink", "mint", "orange", "purple", "cyan", "lime"] as const
export type AvatarColorKey = (typeof AVATAR_COLOR_KEYS)[number]

type SessionTabs = {
  active?: string
  all: string[]
}

export function getAvatarColors(key?: string) {
  if (key && AVATAR_COLOR_KEYS.includes(key as AvatarColorKey)) {
    return {
      background: `var(--avatar-background-${key})`,
      foreground: `var(--avatar-text-${key})`,
    }
  }
  return {
    background: "var(--surface-info-base)",
    foreground: "var(--text-base)",
  }
}

function same<T>(a: readonly T[] | undefined, b: readonly T[] | undefined) {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  return a.every((x, i) => x === b[i])
}

type Dialog = "provider" | "model" | "connect"

type SessionScroll = {
  x: number
  y: number
}

type SessionView = {
  scroll: Record<string, SessionScroll>
  reviewOpen?: string[]
}

export type LocalProject = Partial<Project> & { worktree: string; expanded: boolean }

export type ExpandedSessions = Record<string, boolean>
export type ReviewDiffStyle = "unified" | "split"

export const { use: useLayout, provider: LayoutProvider } = createSimpleContext({
  name: "Layout",
  init: () => {
    const globalSdk = useGlobalSDK()
    const globalSync = useGlobalSync()
    const server = useServer()
    const [store, setStore, _, ready] = persisted(
      "layout.v6",
      createStore({
        sidebar: {
          opened: false,
          width: 280,
        },
        terminal: {
          opened: false,
          height: 280,
        },
        review: {
          opened: false,
          state: "pane" as "pane" | "tab",
          width: REVIEW_PANE.DEFAULT_WIDTH as number,
          diffStyle: "split" as ReviewDiffStyle,
        },
        session: {
          width: 600,
        },
        theme: DEFAULT_THEME_ID,
        font: FONTS[0].id,
        mobileSidebar: {
          opened: false,
        },
        sessionTabs: {} as Record<string, SessionTabs>,
        sessionView: {} as Record<string, SessionView>,
        expandedSessions: {} as ExpandedSessions,
      }),
    )
    const [ephemeral, setEphemeral] = createStore<{
      connect: {
        provider?: string
        state?: "pending" | "complete" | "error"
        error?: string
      }
      dialog: {
        open?: Dialog
      }
      mobileReview: {
        visible?: boolean
        filesCount?: number
        onOpen?: () => void
      }
      mobileMessageNav: {
        visible?: boolean
        messages?: { id: string; title?: string }[]
        currentIndex?: number
        onSelect?: (index: number) => void
      }
    }>({
      connect: {},
      dialog: {},
      mobileReview: {},
      mobileMessageNav: {},
    })
    const usedColors = new Set<AvatarColorKey>()

    function pickAvailableColor(): AvatarColorKey {
      const available = AVATAR_COLOR_KEYS.filter((c) => !usedColors.has(c))
      if (available.length === 0) return AVATAR_COLOR_KEYS[Math.floor(Math.random() * AVATAR_COLOR_KEYS.length)]
      return available[Math.floor(Math.random() * available.length)]
    }

    function enrich(project: { worktree: string; expanded: boolean }) {
      const [childStore] = globalSync.child(project.worktree)
      const projectID = childStore.project
      const metadata = projectID
        ? globalSync.data.project.find((x) => x.id === projectID)
        : globalSync.data.project.find((x) => x.worktree === project.worktree)
      return [
        {
          ...project,
          ...(metadata ?? {}),
          icon: { url: metadata?.icon?.url, color: metadata?.icon?.color },
        },
      ]
    }

    function colorize(project: LocalProject) {
      if (project.icon?.color) return project
      const color = pickAvailableColor()
      usedColors.add(color)
      project.icon = { ...project.icon, color }
      if (project.id) {
        globalSdk.client.project.update({ projectID: project.id, icon: { color } })
      }
      return project
    }

    const enriched = createMemo(() => server.projects.list().flatMap(enrich))
    const list = createMemo(() => enriched().flatMap(colorize))

    onMount(() => {
      // Load project sessions
      Promise.all(
        server.projects.list().map((project) => {
          return globalSync.project.loadSessions(project.worktree)
        }),
      )

      // Normalize persisted review state (ensure opened defaults to false for old/missing state)
      if (store.review === undefined || store.review.opened === undefined) {
        setStore("review", "opened", false)
      }
    })

    createEffect(() => {
      applyTheme(store.theme)
    })

    createEffect(() => {
      const font = getFontById(store.font) ?? FONTS[0]
      applyFontWithLoad(font)
    })

    return {
      ready,
      projects: {
        list,
        open(directory: string) {
          if (server.projects.list().find((x) => x.worktree === directory)) {
            return
          }
          globalSync.project.loadSessions(directory)
          server.projects.open(directory)
        },
        close(directory: string) {
          server.projects.close(directory)
        },
        expand(directory: string) {
          server.projects.expand(directory)
        },
        collapse(directory: string) {
          server.projects.collapse(directory)
        },
        move(directory: string, toIndex: number) {
          server.projects.move(directory, toIndex)
        },
      },
      sidebar: {
        opened: createMemo(() => store.sidebar.opened),
        open() {
          setStore("sidebar", "opened", true)
        },
        close() {
          setStore("sidebar", "opened", false)
        },
        toggle() {
          setStore("sidebar", "opened", (x) => !x)
        },
        width: createMemo(() => store.sidebar.width),
        resize(width: number) {
          setStore("sidebar", "width", width)
        },
      },
      terminal: {
        opened: createMemo(() => store.terminal.opened),
        open() {
          setStore("terminal", "opened", true)
        },
        close() {
          setStore("terminal", "opened", false)
        },
        toggle() {
          setStore("terminal", "opened", (x) => !x)
        },
        height: createMemo(() => store.terminal.height),
        resize(height: number) {
          setStore("terminal", "height", height)
        },
      },
      review: {
        opened: createMemo(() => store.review?.opened ?? true),
        state: createMemo(() => store.review?.state ?? "pane"),
        width: createMemo(() => store.review?.width ?? 450),
        diffStyle: createMemo(() => store.review?.diffStyle ?? "split"),
        setDiffStyle(diffStyle: ReviewDiffStyle) {
          if (!store.review) {
            setStore("review", { opened: true, diffStyle })
            return
          }
          setStore("review", "diffStyle", diffStyle)
        },
        open() {
          setStore("review", "opened", true)
        },
        close() {
          setStore("review", "opened", false)
        },
        toggle() {
          setStore("review", "opened", (x) => !x)
        },
        pane() {
          setStore("review", "state", "pane")
        },
        tab() {
          setStore("review", "state", "tab")
        },
        resize(width: number) {
          setStore("review", "width", width)
        },
      },
      session: {
        width: createMemo(() => store.session?.width ?? 600),
        resize(width: number) {
          // ResizeHandle already enforces min/max constraints
          if (!store.session) {
            setStore("session", { width })
            return
          }
          setStore("session", "width", width)
        },
      },
function same<T>(a: readonly T[] | undefined, b: readonly T[] | undefined) {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  return a.every((x, i) => x === b[i])
}

type Dialog = "provider" | "model" | "connect"
      },
      tabs(sessionKey: string) {
        const tabs = createMemo(() => store.sessionTabs[sessionKey] ?? { all: [] })
        return {
          tabs,
          active: createMemo(() => tabs().active),
          all: createMemo(() => tabs().all),
          setActive(tab: string | undefined) {
            if (!store.sessionTabs[sessionKey]) {
              setStore("sessionTabs", sessionKey, { all: [], active: tab })
            } else {
              setStore("sessionTabs", sessionKey, "active", tab)
            }
          },
          setAll(all: string[]) {
            if (!store.sessionTabs[sessionKey]) {
              setStore("sessionTabs", sessionKey, { all, active: undefined })
            } else {
              setStore("sessionTabs", sessionKey, "all", all)
            }
          },
          async open(tab: string) {
            const current = store.sessionTabs[sessionKey] ?? { all: [] }

            if (tab === "review") {
              if (!store.sessionTabs[sessionKey]) {
                setStore("sessionTabs", sessionKey, { all: [], active: tab })
                return
              }
              setStore("sessionTabs", sessionKey, "active", tab)
              return
            }

            if (tab === "context") {
              const all = [tab, ...current.all.filter((x) => x !== tab)]
              if (!store.sessionTabs[sessionKey]) {
                setStore("sessionTabs", sessionKey, { all, active: tab })
                return
              }
              setStore("sessionTabs", sessionKey, "all", all)
              setStore("sessionTabs", sessionKey, "active", tab)
              return
            }

            if (!current.all.includes(tab)) {
              if (!store.sessionTabs[sessionKey]) {
                setStore("sessionTabs", sessionKey, { all: [tab], active: tab })
                return
              }
              setStore("sessionTabs", sessionKey, "all", [...current.all, tab])
              setStore("sessionTabs", sessionKey, "active", tab)
              return
            }

            if (!store.sessionTabs[sessionKey]) {
              setStore("sessionTabs", sessionKey, { all: current.all, active: tab })
              return
            }
            setStore("sessionTabs", sessionKey, "active", tab)
          },
          close(tab: string) {
            const current = store.sessionTabs[sessionKey]
            if (!current) return

            const all = current.all.filter((x) => x !== tab)
            batch(() => {
              setStore("sessionTabs", sessionKey, "all", all)
              if (current.active !== tab) return

              const index = current.all.findIndex((f) => f === tab)
              const next = all[index - 1] ?? all[0]
              setStore("sessionTabs", sessionKey, "active", next)
            })
          },
          move(tab: string, to: number) {
            const current = store.sessionTabs[sessionKey]
            if (!current) return
            const index = current.all.findIndex((f) => f === tab)
            if (index === -1) return
            setStore(
              "sessionTabs",
              sessionKey,
              "all",
              produce((opened) => {
                opened.splice(to, 0, opened.splice(index, 1)[0])
              }),
            )
          },
        }
      },
    }
  },
})
