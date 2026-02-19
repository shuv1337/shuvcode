import { RGBA } from "@opentui/core"
import { createEffect, createMemo, onMount } from "solid-js"
import { useSync } from "@tui/context/sync"
import { createSimpleContext } from "./helper"
import { Glob } from "../../../../util/glob"
import aura from "./theme/aura.json" with { type: "json" }
import ayu from "./theme/ayu.json" with { type: "json" }
import catppuccin from "./theme/catppuccin.json" with { type: "json" }
import catppuccinFrappe from "./theme/catppuccin-frappe.json" with { type: "json" }
import catppuccinMacchiato from "./theme/catppuccin-macchiato.json" with { type: "json" }
import cobalt2 from "./theme/cobalt2.json" with { type: "json" }
import cursor from "./theme/cursor.json" with { type: "json" }
import dracula from "./theme/dracula.json" with { type: "json" }
import everforest from "./theme/everforest.json" with { type: "json" }
import flexoki from "./theme/flexoki.json" with { type: "json" }
import github from "./theme/github.json" with { type: "json" }
import gruvbox from "./theme/gruvbox.json" with { type: "json" }
import kanagawa from "./theme/kanagawa.json" with { type: "json" }
import material from "./theme/material.json" with { type: "json" }
import matrix from "./theme/matrix.json" with { type: "json" }
import mercury from "./theme/mercury.json" with { type: "json" }
import monokai from "./theme/monokai.json" with { type: "json" }
import nightowl from "./theme/nightowl.json" with { type: "json" }
import nord from "./theme/nord.json" with { type: "json" }
import osakaJade from "./theme/osaka-jade.json" with { type: "json" }
import onedark from "./theme/one-dark.json" with { type: "json" }
import opencode from "./theme/opencode.json" with { type: "json" }
import orng from "./theme/orng.json" with { type: "json" }
import lucentOrng from "./theme/lucent-orng.json" with { type: "json" }
import palenight from "./theme/palenight.json" with { type: "json" }
import rosepine from "./theme/rosepine.json" with { type: "json" }
import solarized from "./theme/solarized.json" with { type: "json" }
import synthwave84 from "./theme/synthwave84.json" with { type: "json" }
import tokyonight from "./theme/tokyonight.json" with { type: "json" }
import vercel from "./theme/vercel.json" with { type: "json" }
import vesper from "./theme/vesper.json" with { type: "json" }
import zenburn from "./theme/zenburn.json" with { type: "json" }
import carbonfox from "./theme/carbonfox.json" with { type: "json" }
import { useKV } from "./kv"
import { useRenderer } from "@opentui/solid"
import { createStore, produce } from "solid-js/store"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
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

export { DEFAULT_THEMES, selectedForeground } from "./theme-utils"
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
      if (theme) setStore("active", theme)
    })

    function init() {
      resolveSystemTheme()
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
    }

    onMount(init)

    function resolveSystemTheme() {
      console.log("resolveSystemTheme")
      renderer
        .getPalette({
          size: 16,
        })
        .then((colors) => {
          console.log(colors.palette)
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
    process.on("SIGUSR2", async () => {
      renderer.clearPaletteCache()
      init()
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
    for (const item of await Glob.scan("themes/*.json", {
      cwd: dir,
      absolute: true,
      dot: true,
      symlink: true,
    })) {
      const name = path.basename(item, ".json")
      result[name] = await Filesystem.readJson(item)
    }
  }
  return result
}

export function tint(base: RGBA, overlay: RGBA, alpha: number): RGBA {
  const r = base.r + (overlay.r - base.r) * alpha
  const g = base.g + (overlay.g - base.g) * alpha
  const b = base.b + (overlay.b - base.b) * alpha
  return RGBA.fromInts(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255))
}
