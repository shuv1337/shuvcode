import { createStore } from "solid-js/store"
import { createMemo, onMount, createEffect } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { makePersisted } from "@solid-primitives/storage"
import { useGlobalSync } from "./global-sync"
import { useGlobalSDK } from "./global-sdk"
import { applyTheme, DEFAULT_THEME_ID } from "@/theme/apply-theme"
import { applyFont } from "@/fonts/apply-font"
import { DEFAULT_FONT_ID } from "@/fonts/font-definitions"

export const { use: useLayout, provider: LayoutProvider } = createSimpleContext({
  name: "Layout",
  init: () => {
    const globalSdk = useGlobalSDK()
    const globalSync = useGlobalSync()

    const [store, setStore] = makePersisted(
      createStore({
        projects: [] as { worktree: string; expanded: boolean }[],
        sidebar: {
          opened: false,
          width: 280,
        },
        terminal: {
          opened: false,
          height: 280,
        },
        review: {
          state: "pane" as "pane" | "tab",
        },
        theme: DEFAULT_THEME_ID,
        font: DEFAULT_FONT_ID,
      }),
      {
        name: "default-layout.v8",
      },
    )

    // Reactively apply theme and font whenever they change or on init
    createEffect(() => {
      const currentTheme = store.theme || DEFAULT_THEME_ID
      applyTheme(currentTheme)
    })

    createEffect(() => {
      const currentFont = store.font || DEFAULT_FONT_ID
      applyFont(currentFont)
    })

    async function loadProjectSessions(directory: string) {
      const [, setStore] = globalSync.child(directory)
      globalSdk.client.session.list({ directory }).then((x) => {
        const data = x.data
        if (!Array.isArray(data)) {
          setStore("session", [])
          return
        }
        const sessions = data
          .slice()
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, 5)
        setStore("session", sessions)
      })
    }

    onMount(() => {
      Promise.all(
        store.projects.map(({ worktree }) => {
          return loadProjectSessions(worktree)
        }),
      )
    })

    function enrich(project: { worktree: string; expanded: boolean }) {
      const metadata = globalSync.data.projects.find((x) => x.worktree === project.worktree)
      if (!metadata) return []
      return [
        {
          ...project,
          ...metadata,
        },
      ]
    }

    return {
      projects: {
        list: createMemo(() => store.projects.flatMap(enrich)),
        open(directory: string) {
          if (store.projects.find((x) => x.worktree === directory)) return
          loadProjectSessions(directory)
          setStore("projects", (x) => [...x, { worktree: directory, expanded: true }])
        },
        close(directory: string) {
          setStore("projects", (x) => x.filter((x) => x.worktree !== directory))
        },
        expand(directory: string) {
          setStore("projects", (x) => x.map((x) => (x.worktree === directory ? { ...x, expanded: true } : x)))
        },
        collapse(directory: string) {
          setStore("projects", (x) => x.map((x) => (x.worktree === directory ? { ...x, expanded: false } : x)))
        },
        move(directory: string, toIndex: number) {
          setStore("projects", (projects) => {
            const fromIndex = projects.findIndex((x) => x.worktree === directory)
            if (fromIndex === -1 || fromIndex === toIndex) return projects
            const result = [...projects]
            const [item] = result.splice(fromIndex, 1)
            result.splice(toIndex, 0, item)
            return result
          })
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
        state: createMemo(() => store.review?.state ?? "closed"),
        pane() {
          setStore("review", "state", "pane")
        },
        tab() {
          setStore("review", "state", "tab")
        },
      },
      theme: {
        current: createMemo(() => store.theme ?? DEFAULT_THEME_ID),
        set(id: string) {
          setStore("theme", id)
        },
      },
      font: {
        current: createMemo(() => store.font ?? DEFAULT_FONT_ID),
        set(id: string) {
          setStore("font", id)
        },
      },
    }
  },
})
