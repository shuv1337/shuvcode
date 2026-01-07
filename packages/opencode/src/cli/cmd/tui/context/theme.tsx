import { RGBA } from "@opentui/core"
import { createEffect, createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { createSimpleContext } from "./helper"
import { useKV } from "./kv"
import { useRenderer } from "@opentui/solid"
import { createStore, produce } from "solid-js/store"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { useSDK } from "./sdk"
import path from "path"
import {
  DEFAULT_THEMES,
  generateSubtleSyntax,
  generateSyntax,
  generateSystem,
  resolveTheme,
  type Theme,
  type ThemeJson,
} from "./theme-utils"

export { selectedForeground } from "./theme-utils"
export type { Theme, ThemeColors, ThemeJson } from "./theme-utils"

export const { use: useTheme, provider: ThemeProvider } = createSimpleContext({
  name: "Theme",
  init: (props: { mode: "dark" | "light" }) => {
    const sync = useSync()
    const kv = useKV()
    const [store, setStore] = createStore({
      themes: DEFAULT_THEMES,
      mode: kv.get("theme_mode", props.mode),
      active: (sync.data.config.theme ?? kv.get("theme", "nightowl")) as string,
      transparent: kv.get("theme_transparent", false),
      ready: false,
    })

    createEffect(() => {
      const theme = sync.data.config.theme
      console.log("theme", theme)
      if (theme) setStore("active", theme)
    })

    createEffect(() => {
      getCustomThemes()
        .then((custom) => {
          setStore(
            produce((draft) => {
              Object.assign(draft.themes, custom)
            }),
          )
        })
        .catch(() => {
          setStore("active", "opencode")
        })
        .finally(() => {
          if (store.active !== "system") {
            setStore("ready", true)
          }
        })
    })

    function resolveSystemTheme() {
      console.log("resolved system theme")
      renderer
        .getPalette({
          size: 16,
        })
        .then((colors) => {
          if (!colors.palette[0]) {
            if (store.active === "system") {
              setStore(
                produce((draft) => {
                  draft.active = "opencode"
                  draft.ready = true
                }),
              )
            }
            return
          }
          setStore(
            produce((draft) => {
              draft.themes.system = generateSystem(colors, store.mode)
              if (store.active === "system") {
                draft.ready = true
              }
            }),
          )
        })
    }

    const renderer = useRenderer()
    resolveSystemTheme()

    const sdk = useSDK()
    sdk.event.on("server.instance.disposed", () => {
      resolveSystemTheme()
    })

    const values = createMemo(() => {
      return resolveTheme(store.themes[store.active] ?? store.themes.nightowl, store.mode, store.transparent)
    })

    const syntax = createMemo(() => generateSyntax(values()))
    const subtleSyntax = createMemo(() => generateSubtleSyntax(values()))

    return {
      theme: new Proxy(values(), {
        get(_target, prop) {
          // @ts-expect-error
          return values()[prop]
        },
      }),
      get selected() {
        return store.active
      },
      all() {
        return store.themes
      },
      syntax,
      subtleSyntax,
      mode() {
        return store.mode
      },
      setMode(mode: "dark" | "light") {
        setStore("mode", mode)
        kv.set("theme_mode", mode)
      },
      set(theme: string) {
        setStore("active", theme)
        kv.set("theme", theme)
      },
      transparent() {
        return store.transparent
      },
      setTransparent(transparent: boolean) {
        setStore("transparent", transparent)
        kv.set("theme_transparent", transparent)
      },
      get ready() {
        return store.ready
      },
    }
  },
})

const CUSTOM_THEME_GLOB = new Bun.Glob("themes/*.json")
async function getCustomThemes() {
  const directories = [
    Global.Path.config,
    ...(await Array.fromAsync(
      Filesystem.up({
        targets: [".opencode"],
        start: process.cwd(),
      }),
    )),
  ]

  const result: Record<string, ThemeJson> = {}
  for (const dir of directories) {
    for await (const item of CUSTOM_THEME_GLOB.scan({
      absolute: true,
      followSymlinks: true,
      dot: true,
      cwd: dir,
    })) {
      const name = path.basename(item, ".json")
      result[name] = await Bun.file(item).json()
    }
  }
  return result
}
