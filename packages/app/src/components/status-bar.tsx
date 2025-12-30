import { createMemo, Show, type ParentProps } from "solid-js"
import { usePlatform } from "@/context/platform"
import { useSync } from "@/context/sync"
import { useGlobalSync } from "@/context/global-sync"

export function StatusBar(props: ParentProps) {
  const platform = usePlatform()
  const sync = useSync()
  const globalSync = useGlobalSync()

  const directoryDisplay = createMemo(() => {
    const directory = sync.data.path.directory || ""
    const home = globalSync.data.path.home || ""
    const short = home && directory.startsWith(home) ? directory.replace(home, "~") : directory
    const branch = sync.data.vcs?.branch
    return branch ? `${short}:${branch}` : short
  })

  return (
    <div class="h-8 w-full shrink-0 flex items-center justify-between gap-2 px-2 border-t border-border-weak-base bg-background-base">
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <Show when={platform.version}>
          <span class="text-12-regular text-text-weak shrink-0">v{platform.version}</span>
        </Show>
        <Show when={directoryDisplay()}>
          <span
            class="text-12-regular text-text-weak truncate min-w-0"
            style={{ direction: "rtl", "text-align": "left" }}
            title={directoryDisplay()}
          >
            {directoryDisplay()}
          </span>
        </Show>
      </div>
      <div class="flex items-center shrink-0">{props.children}</div>
    </div>
  )
}
