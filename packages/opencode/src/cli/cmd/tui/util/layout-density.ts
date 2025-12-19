import { createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useSync } from "@tui/context/sync"
import { useKV } from "../context/kv"

export type Density = "comfortable" | "compact"

export const COMPACT_HEIGHT_THRESHOLD = 28

export function useLayoutDensity() {
  const dimensions = useTerminalDimensions()
  const sync = useSync()
  const kv = useKV()

  const density = createMemo<Density>(() => {
    const override = kv.get("tui_density_override", "auto") as Density | "auto"
    if (override === "comfortable") return "comfortable"
    if (override === "compact") return "compact"

    const configDensity = (sync.data.config.tui as any)?.density || "auto"
    if (configDensity === "comfortable") return "comfortable"
    if (configDensity === "compact") return "compact"

    // auto mode
    return dimensions().height < COMPACT_HEIGHT_THRESHOLD ? "compact" : "comfortable"
  })

  const isCompact = createMemo(() => density() === "compact")

  const tokens = createMemo(() => ({
    paddingY: isCompact() ? 0 : 1,
    gap: isCompact() ? 0 : 1,
    sidebarPaddingY: isCompact() ? 0 : 1,
    homePaddingY: isCompact() ? 0 : 1,
    showFooter: dimensions().height > 15,
    showSecondaryHints: dimensions().height > 20,
  }))

  const toggle = () => {
    const current = density()
    const next = current === "comfortable" ? "compact" : "comfortable"
    kv.set("tui_density_override", next)
  }

  const reset = () => {
    kv.set("tui_density_override", "auto")
  }

  return {
    density,
    isCompact,
    tokens,
    toggle,
    reset,
  }
}
