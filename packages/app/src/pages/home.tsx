import { useGlobalSync } from "@/context/global-sync"
import { createMemo, For, Match, Show, Switch } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { AsciiLogo } from "@opencode-ai/ui/logo"
import { useLayout } from "@/context/layout"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/util/encode"
import { Icon } from "@opencode-ai/ui/icon"
import { DateTime } from "luxon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogCreateProject } from "@/components/dialog-create-project"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { useServer } from "@/context/server"

export default function Home() {
  const sync = useGlobalSync()
  const layout = useLayout()
  const dialog = useDialog()
  const navigate = useNavigate()
  const server = useServer()
  const homedir = createMemo(() => sync.data.path.home)

  function openProject(directory: string) {
    layout.projects.open(directory)
    navigate(`/${base64Encode(directory)}`)
  }

  function addProject() {
    dialog.show(() => <DialogCreateProject />)
  }

  return (
    <div class="size-full bg-background-base flex flex-col items-center pt-20 sm:pt-55 pb-safe-bottom overflow-y-auto no-scrollbar">
      <AsciiLogo scale={1.5} class="opacity-30 max-[40rem]:scale-75 max-[40rem]:origin-center" />
      <Button
        size="small"
        variant="ghost"
        class="mt-4 mx-auto text-14-regular text-text-weak"
        onClick={() => dialog.show(() => <DialogSelectServer />)}
      >
        <div
          classList={{
            "size-2 rounded-full": true,
            "bg-icon-success-base": server.healthy() === true,
            "bg-icon-critical-base": server.healthy() === false,
            "bg-border-weak-base": server.healthy() === undefined,
          }}
        />
        {server.name}
      </Button>
      <Switch>
        <Match when={sync.data.project.length > 0}>
          <div class="mt-10 sm:mt-20 w-full max-w-xl flex flex-col gap-4 px-4 sm:px-3 pb-10">
            <div class="flex gap-2 items-center justify-between flex-wrap">
              <div class="text-14-medium text-text-strong">Recent projects</div>
              <Button
                icon="folder-add-left"
                size="normal"
                class="pl-2 pr-3"
                onClick={addProject}
              >
                <span class="hidden sm:inline">Add project</span>
                <span class="sm:hidden">Add</span>
              </Button>
            </div>
            <ul class="flex flex-col gap-2">
              <For
                each={sync.data.project
                  .toSorted((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
                  .slice(0, 10)}
              >
                {(project) => (
                  <Button
                    size="large"
                    variant="ghost"
                    class="text-14-mono text-left justify-between px-3 gap-3"
                    onClick={() => openProject(project.worktree)}
                  >
                    <span class="truncate min-w-0">{project.worktree.replace(homedir() || "", "~")}</span>
                    <span class="text-14-regular text-text-weak shrink-0">
                      {DateTime.fromMillis(project.time.updated ?? project.time.created).toRelative()}
                    </span>
                  </Button>
                )}
              </For>
            </ul>
          </div>
        </Match>
        <Match when={true}>
          <div class="mt-30 mx-auto flex flex-col items-center gap-3">
            <Icon name="folder-add-left" size="large" />
            <div class="flex flex-col gap-1 items-center justify-center">
              <div class="text-14-medium text-text-strong">No recent projects</div>
              <div class="text-12-regular text-text-weak">Get started by adding a project</div>
            </div>
            <div />
            <Button class="px-3" onClick={addProject}>
              Add project
            </Button>
          </div>
        </Match>
      </Switch>
    </div>
  )
}
