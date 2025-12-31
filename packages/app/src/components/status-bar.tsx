import { createMemo, createSignal, Show, type ParentProps } from "solid-js"
import { useSync } from "@/context/sync"
import { useGlobalSync } from "@/context/global-sync"
import { useServer } from "@/context/server"
import { usePlatform } from "@/context/platform"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Button } from "@opencode-ai/ui/button"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Icon } from "@opencode-ai/ui/icon"

export function StatusBar(props: ParentProps) {
  const dialog = useDialog()
  const server = useServer()
  const sync = useSync()
  const globalSync = useGlobalSync()
  const platform = usePlatform()
  const [copied, setCopied] = createSignal(false)

  const directoryShort = createMemo(() => {
    const directory = sync.data.path.directory || ""
    const home = globalSync.data.path.home || ""
    return home && directory.startsWith(home) ? directory.replace(home, "~") : directory
  })

  const directoryDisplay = createMemo(() => {
    const short = directoryShort()
    const branch = sync.data.vcs?.branch
    return branch ? `${short}:${branch}` : short
  })

  const fullPath = createMemo(() => {
    return sync.data.path.directory || ""
  })

  const copyPath = async () => {
    const path = fullPath()
    if (!path) return
    try {
      await navigator.clipboard.writeText(path)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      console.error("Failed to copy path:", e)
    }
  }

  return (
    <div class="h-8 w-full shrink-0 flex items-center justify-between gap-2 px-2 border-t border-border-weak-base bg-background-base">
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <div class="flex items-center gap-1">
          <Button
            size="small"
            variant="ghost"
            onClick={() => {
              dialog.show(() => <DialogSelectServer />)
            }}
          >
            <div
              classList={{
                "size-1.5 rounded-full": true,
                "bg-icon-success-base": server.healthy() === true,
                "bg-icon-critical-base": server.healthy() === false,
                "bg-border-weak-base": server.healthy() === undefined,
              }}
            />

            <span class="text-12-regular text-text-weak">{server.name}</span>
          </Button>
        </div>
        <Show when={platform.version}>
          <span class="text-12-regular text-text-weak shrink-0">v{platform.version}</span>
        </Show>
        <Show when={directoryDisplay()}>
          <Tooltip
            value={copied() ? "Copied!" : "Click to copy path"}
          >
            <button
              type="button"
              class="text-12-regular text-text-weak min-w-0 flex items-center gap-1 hover:text-text-base transition-colors cursor-pointer group"
              onClick={copyPath}
              title={fullPath()}
            >
              <span 
                class="truncate block"
                style={{ direction: "rtl", "text-align": "left" }}
              >
                <bdi>{directoryDisplay()}</bdi>
              </span>
              <Show when={copied()}>
                <Icon name="check-small" class="shrink-0 size-3 text-icon-success-base" />
              </Show>
            </button>
          </Tooltip>
        </Show>
      </div>
      <div class="flex items-center shrink-0">{props.children}</div>
    </div>
  )
}
