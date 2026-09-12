import { For, Show, createMemo, type Component } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { displayName } from "@/shell/layout/helpers"
import { ProjectIcon } from "@/shell/layout/project-icon"
import type { LocalProject } from "@/shell/state/layout"
import "@/settings/settings.css"

export const SettingsProjects: Component<{
  server: ServerConnection.Any
  onOpenProject: (project: LocalProject) => void
}> = (props) => {
  const language = useLanguage()
  const global = useGlobal()
  const projects = createMemo(() => global.ensureServerCtx(props.server).projects.list())

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.projects.title")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.projects.description")}</span>
          </div>
        </div>
      </div>

      <div class="settings-tab-body">
        <Show
          when={projects().length > 0}
          fallback={
            <div class="py-12 text-center text-v2-text-text-muted text-13-regular">
              {language.t("settings.projects.empty")}
            </div>
          }
        >
          <div class="flex w-full flex-col gap-2">
            <For each={projects()}>
              {(project) => (
                <button
                  type="button"
                  aria-label={displayName(project)}
                  class="group mx-px flex items-center justify-between gap-5 px-4 py-2.5 rounded-lg bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)] transition-[background-color] hover:bg-v2-background-bg-layer-01 text-start"
                  onClick={() => props.onOpenProject(project)}
                >
                  <span class="flex items-center gap-2.5 min-w-0 flex-1">
                    <ProjectIcon project={project} class="shrink-0" />
                    <bdi class="text-13-medium text-v2-text-text-base truncate">{displayName(project)}</bdi>
                  </span>
                  <Icon
                    name="chevron-right"
                    size="small"
                    class="shrink-0 text-v2-icon-icon-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                  />
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </>
  )
}
