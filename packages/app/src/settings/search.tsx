import { createEffect, createMemo, createUniqueId, For, on, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Icon } from "@opencode/ui/icon"
import { TextInput } from "@opencode/ui/text-input"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useGlobal } from "@/runtime/server/runtime"
import { ProjectIcon } from "@/shell/layout/project-icon"
import { useCommand } from "@/shell/commands/command"
import { settingsProjects, useSettingsServers } from "./servers/inventory"
import { useSettingsSurface } from "./surface"
import { pageIcons } from "./pages"
import { rankSettings, type SettingsSearchResult } from "./search-results"
import { settingsSearchIndex } from "./search-index"

export function SettingsSearch() {
  const language = useLanguage()
  const command = useCommand()
  const platform = usePlatform()
  const global = useGlobal()
  const servers = useSettingsServers()
  const surface = useSettingsSurface()
  const search = surface.search
  const mobile = createMediaQuery("(max-width: 767px)")
  const [state, setState] = createStore({ narrow: false })
  const listID = `settings-results-${createUniqueId()}`
  let root: HTMLDivElement | undefined
  let input: HTMLInputElement | undefined
  let results: HTMLDivElement | undefined
  onMount(() => {
    const screen = root?.closest<HTMLElement>(".settings-screen")
    if (!screen) return
    setState("narrow", screen.clientWidth < 800)
    createResizeObserver(screen, (rect) => setState("narrow", rect.width < 800))
  })
  command.register("settings.search", () => [
    {
      id: "settings.search.focus",
      title: language.t("settings.search.placeholder"),
      keybind: "mod+f",
      hidden: true,
      onSelect: () => {
        input?.focus({ preventScroll: true })
        input?.select()
      },
    },
  ])
  const inventory = createMemo(() =>
    servers().map((server) => {
      const context = server.connection ? global.ensureServerCtx(server.connection) : undefined
      return {
        ...server,
        connected: context?.sdk.connection.status() === "connected",
        projects: context ? settingsProjects(context) : [],
      }
    }),
  )
  const origin = () => search.state.origin ?? surface.view()
  const catalog = createMemo(() =>
    settingsSearchIndex({
      servers: inventory(),
      desktop: platform.platform === "desktop",
      browser: !!platform.browserPane,
      dev: import.meta.env.VITE_OPENCODE_CHANNEL !== "prod",
      mobile: mobile(),
      translate: language.t,
    }),
  )
  const matches = createMemo(() => rankSettings(search.state.query, catalog(), origin()))
  const shown = createMemo(() => matches().slice(0, 60))
  const expanded = () => !!search.state.query.trim() && (!state.narrow || search.state.expanded)
  const highlighted = () => shown().find((item) => item.id === search.state.highlighted) ?? shown()[0]
  const optionID = (id: string) => `${listID}-${encodeURIComponent(id)}`
  createEffect(
    on(
      () => search.state.query,
      () => {
        if (results) results.scrollTop = 0
      },
      { defer: true },
    ),
  )
  const group = (item: SettingsSearchResult) => {
    if (!item.server || servers().length > 1) return item.owner
    return item.projectName ?? ""
  }
  const select = (item: SettingsSearchResult) => {
    surface.search.open(item.view, item.id)
    if (state.narrow && item.view.type === "root") {
      input?.blur()
      root?.closest<HTMLElement>(".settings-screen")?.focus({ preventScroll: true })
    }
  }
  const clear = () => {
    search.clear()
    input?.focus()
  }

  return (
    <div
      ref={root}
      class="settings-search"
      data-expanded={search.state.expanded}
      data-empty={!search.state.query.trim()}
      onKeyDown={(event) => {
        if (
          event.defaultPrevented ||
          event.isComposing ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey
        )
          return
        if (
          event.target !== input &&
          !(event.target instanceof Element && event.target.closest(".settings-search-result"))
        )
          return
        if (event.key === "Escape" && search.state.query) {
          event.preventDefault()
          event.stopPropagation()
          clear()
          return
        }
        if (event.key === "Enter" && expanded() && highlighted()) {
          event.preventDefault()
          select(highlighted()!)
          return
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
        if ((event.key === "Home" || event.key === "End") && event.target === input) return
        event.preventDefault()
        search.expand()
        const index = shown().findIndex((item) => item.id === highlighted()?.id)
        const next =
          shown()[
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? shown().length - 1
                : Math.max(0, Math.min(shown().length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))
          ]
        if (!next) return
        search.highlight(next.id)
        const row = results?.querySelector<HTMLElement>(`#${CSS.escape(optionID(next.id))}`)
        if (event.target !== input) row?.focus({ preventScroll: true })
        row?.scrollIntoView({ block: "nearest", inline: "nearest" })
      }}
    >
      <TextInput
        ref={input}
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded()}
        aria-activedescendant={expanded() && highlighted() ? optionID(highlighted()!.id) : undefined}
        value={search.state.query}
        leadingIcon={<Icon name="magnifying-glass" size="small" />}
        placeholder={language.t("settings.search.placeholder")}
        aria-label={language.t("settings.search.placeholder")}
        aria-controls={search.state.query.trim() ? listID : undefined}
        showClearButton
        onClearClick={clear}
        onFocus={() => search.expand()}
        onInput={(event) => {
          search.input(event.currentTarget.value)
        }}
        spellcheck={false}
        autocomplete="off"
      />
      <Show when={search.state.query.trim()}>
        <div class="settings-search-matches">
          <div
            ref={(element) => {
              results = element
              queueMicrotask(() => {
                if (element.isConnected) element.scrollTop = search.state.scrollTop
              })
            }}
            id={listID}
            class="settings-search-results"
            role="listbox"
            aria-label={language.t("settings.search.results")}
            onScroll={(event) => search.scroll(event.currentTarget.scrollTop)}
          >
            <For each={shown()}>
              {(item, index) => (
                <>
                  <Show when={group(item) && (index() === 0 || group(shown()[index() - 1]) !== group(item))}>
                    <div class="settings-search-group" role="presentation">
                      <bdi dir="auto">{group(item)}</bdi>
                    </div>
                  </Show>
                  <button
                    id={optionID(item.id)}
                    role="option"
                    aria-selected={highlighted()?.id === item.id}
                    aria-label={
                      item.page === item.title && !item.owner
                        ? item.title
                        : language.t(
                            item.page === item.title
                              ? "settings.search.page"
                              : item.owner
                                ? "settings.search.result"
                                : "settings.search.result.unscoped",
                            { title: item.title, scope: item.owner, page: item.page },
                          )
                    }
                    type="button"
                    class="settings-search-result"
                    data-compact={item.page === item.title}
                    data-setting-target={item.view.target}
                    data-result-id={item.id}
                    data-highlighted={highlighted()?.id === item.id}
                    aria-current={search.state.selected === item.id ? "location" : undefined}
                    title={[item.owner, item.page].filter(Boolean).join(" › ")}
                    tabIndex={highlighted()?.id === item.id ? 0 : -1}
                    onFocus={() => search.highlight(item.id)}
                    onClick={(event) => {
                      if (item.view.type === "root" && !state.narrow) event.currentTarget.focus({ preventScroll: true })
                      select(item)
                    }}
                  >
                    <span class="settings-search-label">
                      <Show
                        when={item.projectInfo}
                        fallback={
                          <Show when={item.topLevel}>
                            <Icon name={pageIcons[item.view.tab]} />
                          </Show>
                        }
                      >
                        {(project) => (
                          <ProjectIcon project={project()} class="settings-search-project-icon" aria-hidden="true" />
                        )}
                      </Show>
                      <bdi dir="auto" class="settings-search-title">
                        {item.title}
                      </bdi>
                    </span>
                    <Show when={item.page !== item.title}>
                      <span class="settings-search-detail">{item.page}</span>
                    </Show>
                  </button>
                </>
              )}
            </For>
          </div>
          <Show when={!matches().length}>
            <div class="settings-search-empty" role="status">
              {language.t("settings.search.empty")}
            </div>
          </Show>
          <Show when={matches().length > shown().length}>
            <p class="settings-search-note">{language.t("settings.search.refine")}</p>
          </Show>
        </div>
      </Show>
    </div>
  )
}
