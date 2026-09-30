import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { LineCommentEditor, type LineCommentEditorMention } from "@opencode/ui/line-comment"
import { Loader } from "@opencode/ui/loader"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import { useDialog } from "@opencode/ui/context/dialog"
import { createEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createEffect, For, on, onCleanup, Show, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import type { BrowserPaneElement } from "@/runtime/platform/browser-pane"
import { usePlatform } from "@/runtime/platform/platform"
import { formatKeybindParts, useCommand } from "@/shell/commands/command"
import type { Browser } from "@opencode/plugin-browser/rpc"
import type { createSessionBrowser } from "./model"

/** A comment on an element the user picked in the page. The ref is absent once the page navigated. */
export type SessionBrowserComment = {
  tabID: Browser.TabID
  url: string
  title: string
  element: Omit<BrowserPaneElement, "rect" | "ref"> & { ref?: Browser.Ref }
  comment: string
}

export function SessionBrowserPane(props: {
  browser: ReturnType<typeof createSessionBrowser>
  visible: boolean
  onComment?: (comment: SessionBrowserComment) => void
  mention?: LineCommentEditorMention
}) {
  const platform = usePlatform()
  const language = useLanguage()
  const dialog = useDialog()
  const command = useCommand()
  const state = props.browser.active
  const address = () => (state()?.url === "about:blank" ? "" : (state()?.url ?? ""))
  const failed = () => !!state()?.loadError
  const registration = props.browser.registration
  const button = { variant: "ghost", size: "large" } as const
  const [store, setStore] = createStore({
    address: "",
    editing: false,
    submitted: false,
    // A submitted navigation the browser has not reported yet; keeps the empty state hidden meanwhile.
    navigating: false,
    visible: typeof document === "undefined" || document.visibilityState === "visible",
    // A still of the page shown in the DOM while floating content covers the hidden native view.
    snapshot: undefined as { tabID: Browser.TabID; url: string } | undefined,
    // The tab whose element picker is on.
    picking: undefined as Browser.TabID | undefined,
    // A picked element awaiting its comment. The page stays frozen as a still until it closes.
    comment: undefined as
      | {
          tabID: Browser.TabID
          url: string
          title: string
          // The tab's navigation count at the pick; the element's ref dies when it changes.
          generation: number
          element: BrowserPaneElement
          draft: string
        }
      | undefined,
    size: { width: 0, height: 0 },
    editorHeight: 0,
  })
  const empty = () => !address() && !state()?.loading && !store.navigating
  const inspectable = () => !!props.onComment && !!address() && !failed() && !props.browser.suspended()
  const picking = () => !!state() && store.picking === state()?.id
  const setPicking = (tabID: Browser.TabID, enabled: boolean) => {
    registration()?.inspect(tabID, enabled)
    setStore("picking", enabled ? tabID : undefined)
  }
  const toggleInspect = () => {
    const tab = state()
    if (!tab || !inspectable()) return
    if (store.comment) closeComment()
    setPicking(tab.id, !picking())
  }
  const closeComment = () => {
    const current = store.comment
    if (!current) return
    registration()?.highlight(current.tabID)
    setStore("comment", undefined)
  }
  const submitComment = (value: string) => {
    const current = store.comment
    if (!current) return
    const tab = state()
    // The draft outlives a reload or agent navigation, but the ref no longer names anything.
    const live = tab?.id === current.tabID && tab.generation === current.generation
    props.onComment?.({
      tabID: current.tabID,
      url: current.url,
      title: current.title,
      element: {
        ...(live ? { ref: current.element.ref } : {}),
        selector: current.element.selector,
        label: current.element.label,
        ...(current.element.role ? { role: current.element.role } : {}),
        ...(current.element.name ? { name: current.element.name } : {}),
        ...(current.element.text ? { text: current.element.text } : {}),
      },
      comment: value,
    })
    closeComment()
  }
  // The picked element in surface pixels, and the editor anchored below it, above it, or over it.
  const spotlight = () => {
    const rect = store.comment?.element.rect
    if (!rect) return
    const zoom = platform.webviewZoom?.() ?? 1
    return { x: rect.x / zoom, y: rect.y / zoom, width: rect.width / zoom, height: rect.height / zoom }
  }
  const placement = () => {
    const rect = spotlight()
    if (!rect) return
    const gap = 8
    const width = Math.max(0, Math.min(400, store.size.width - gap * 2))
    // The editor scrolls rather than growing past the surface, so its actions stay reachable.
    const maxHeight = Math.max(0, store.size.height - gap * 2)
    // Until the editor has been measured once, assume its default three-row height.
    const height = Math.min(store.editorHeight || 176, maxHeight)
    const left = Math.min(Math.max(gap, rect.x), Math.max(gap, store.size.width - width - gap))
    const below = rect.y + rect.height + gap
    const above = rect.y - gap - height
    const top =
      below + height <= store.size.height - gap
        ? below
        : above >= gap
          ? above
          : Math.max(gap, store.size.height - height - gap)
    return { left, top, width, maxHeight }
  }
  let surface: HTMLDivElement | undefined
  let addressDisplay: HTMLDivElement | undefined
  let frame: number | undefined
  let layout: string | undefined
  let until = 0
  let capturing: Browser.TabID | undefined
  let release: ReturnType<typeof setTimeout> | undefined
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 1
  const paint = canvas.getContext("2d", { willReadFrequently: true })
  const scheme = () => store.address.match(/^https?:\/\//i)?.[0] ?? ""
  const error = () => {
    const value = props.browser.error()
    if (value === "browser.pane.replaced") return language.t("session.browser.replaced")
    if (value === "browser.pane.unsupported") return language.t("session.browser.unsupported")
    return value
  }

  command.register("browser.navigation", () => [
    {
      id: "browser.reload",
      title: language.t("command.browser.reload"),
      category: language.t("command.category.view"),
      keybind: "f5",
      disabled: !props.visible || !address(),
      onSelect: () => {
        const tab = state()
        if (tab) props.browser.command({ type: "reload", tabID: tab.id })
      },
    },
    // Ctrl+Shift+C copies in the terminal, so only the focused page claims it, as in Chromium.
    {
      id: "browser.inspect",
      title: language.t("command.browser.inspect"),
      category: language.t("command.category.view"),
      disabled: !props.visible || !inspectable(),
      onSelect: toggleInspect,
    },
  ])

  createEffect(() => {
    onCleanup(
      props.browser.onInspect((event) => {
        if (event.active) {
          setStore("picking", event.tabID)
          return
        }
        if (store.picking === event.tabID) setStore("picking", undefined)
        if (!event.element) return
        const tab = state()
        if (!props.onComment || tab?.id !== event.tabID || !props.visible || !store.visible) {
          registration()?.highlight(event.tabID)
          return
        }
        setStore("comment", {
          tabID: tab.id,
          url: tab.url,
          title: tab.title,
          generation: tab.generation,
          element: event.element,
          draft: "",
        })
      }),
    )
  })
  // A picker or comment belongs to the page on screen; switching tabs or hiding the pane ends it.
  createEffect(
    on([() => state()?.id, () => props.visible && store.visible], ([id, shown]) => {
      const tabID = untrack(() => store.picking)
      if (tabID && (tabID !== id || !shown)) setPicking(tabID, false)
      if (untrack(() => store.comment)?.tabID !== id) closeComment()
    }),
  )
  // The page does not have focus while the picker waits for a hover, so Escape reaches the app.
  createEventListener(
    window,
    "keydown",
    (event) => {
      if (event.key !== "Escape" || !store.picking) return
      event.preventDefault()
      event.stopPropagation()
      setPicking(store.picking, false)
    },
    { capture: true },
  )

  // The native page always paints above the DOM, so hide it while a floating
  // menu, select, or popover overlaps it. Tooltips are excluded.
  const covered = (rect: DOMRect) =>
    Array.from(document.querySelectorAll('[data-popper-positioner]:not(:has([role="tooltip"]))')).some((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.left < rect.right && r.right > rect.left && r.top < rect.bottom && r.bottom > rect.top
    })
  const replaceSnapshot = (next?: { tabID: Browser.TabID; url: string }) => {
    if (store.snapshot?.url) URL.revokeObjectURL(store.snapshot.url)
    setStore("snapshot", next)
  }
  // Keep the page on screen as a still under the floating content. The native view
  // stays visible until the still has decoded, so the pane never flashes blank.
  const freeze = (tabID: Browser.TabID) => {
    clearTimeout(release)
    release = undefined
    if (store.snapshot?.tabID === tabID || capturing === tabID) return
    capturing = tabID
    void (registration()?.capture(tabID) ?? Promise.resolve(null))
      .catch(() => null)
      .then(async (blob) => {
        const url = blob ? URL.createObjectURL(blob) : ""
        if (url) {
          const image = new Image()
          image.src = url
          await image.decode().catch(() => undefined)
        }
        if (capturing !== tabID) {
          if (url) URL.revokeObjectURL(url)
          return
        }
        capturing = undefined
        // A failed capture still hides the page; the pane shows its background as before.
        replaceSnapshot({ tabID, url })
        schedule()
      })
  }
  const thaw = () => {
    capturing = undefined
    if (!store.snapshot || release !== undefined) return
    // Keep the still under the native view until the view has painted again.
    release = setTimeout(() => {
      release = undefined
      replaceSnapshot()
    }, 150)
  }
  const measure = () => {
    if (!surface) return
    const tab = state()
    if (!tab) {
      registration()?.setLayout()
      return
    }
    const rect = surface.getBoundingClientRect()
    const zoom = platform.webviewZoom?.() ?? 1
    const left = Math.round(rect.left * zoom)
    const top = Math.round(rect.top * zoom)
    const right = Math.round(rect.right * zoom)
    const bottom = Math.round(rect.bottom * zoom)
    // The desktop page hides blank and loading documents itself; only hide here
    // while the pane shows its own empty or failed state over the surface.
    const shown = props.visible && store.visible && !empty() && !failed() && !dialog.active
    // A comment on a picked element freezes the page so its editor can float above it.
    const cover = store.comment?.tabID === tab.id || covered(rect)
    if (shown && cover) freeze(tab.id)
    if (!cover) thaw()
    const visible = shown && !(cover && store.snapshot?.tabID === tab.id)
    // The cutout exposes the app backdrop outside the rounded Review card,
    // not the browser surface inside it.
    const color = getComputedStyle(
      surface.closest(".bg-v2-background-bg-deep") ?? document.documentElement,
    ).backgroundColor
    const next = `${tab.id}:${visible}:${left}:${top}:${right}:${bottom}:${color}:${window.devicePixelRatio}`
    if (next !== layout) {
      layout = next
      // Let the browser resolve the semantic backdrop color, including custom
      // themes using color formats that Electron's color parser cannot read.
      if (paint) {
        paint.clearRect(0, 0, 1, 1)
        paint.fillStyle = color
        paint.fillRect(0, 0, 1, 1)
      }
      const rgba = paint?.getImageData(0, 0, 1, 1).data
      registration()?.setLayout({
        tabID: tab.id,
        visible,
        bounds: { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) },
        background: rgba ? [rgba[0], rgba[1], rgba[2], rgba[3]] : undefined,
        radius: Math.round(10 * zoom),
      })
    }
  }
  const tick = () => {
    frame = undefined
    measure()
    if (performance.now() < until) frame = requestAnimationFrame(tick)
  }
  const schedule = (duration = 0) => {
    until = Math.max(until, performance.now() + duration)
    if (frame === undefined) frame = requestAnimationFrame(tick)
  }

  createEffect(on([() => state()?.id, address], () => !store.editing && setStore("address", address())))
  // Any reported movement, including a rejected or blocked request, ends the submitted navigation.
  createEffect(
    on(
      [() => state()?.id, () => state()?.generation, () => state()?.loading, () => props.browser.error()],
      () => setStore("navigating", false),
      { defer: true },
    ),
  )
  // A blocked or rejected submission leaves the page where it was; show that page's URL again.
  createEffect(
    on(
      () => props.browser.error(),
      (error) => {
        if (error && !store.editing) setStore("address", address())
      },
      { defer: true },
    ),
  )
  createEffect(
    on(registration, (current) => {
      // Session routes can change before this pane unmounts. Hide the registration
      // that owned the native view, rather than reading the destination's handle.
      onCleanup(() => current?.setLayout())
    }),
  )
  createEffect(
    on(
      [
        () => platform.webviewZoom?.(),
        () => dialog.active,
        () => store.visible,
        () => props.visible,
        () => state()?.id,
        () => store.comment?.tabID,
        empty,
        failed,
        registration,
      ],
      () => {
        layout = undefined
        // Native views are not clipped by the retained panel's DOM. Hide before
        // the next animation frame so closing the panel cannot leave its page above the app.
        if (!props.visible || !store.visible || dialog.active || !state()) {
          registration()?.setLayout()
          return
        }
        schedule(300)
      },
    ),
  )
  // ResizeObserver runs after layout in the same frame; measuring here instead of on the next
  // animation frame keeps the native view in step with a pane drag.
  createResizeObserver(
    () => surface,
    (rect) => {
      measure()
      setStore("size", { width: rect.width, height: rect.height })
    },
  )
  createEventListener(window, "resize", () => schedule(300))
  // Floating content portals directly into <body>; keep measuring briefly so
  // the positioner has settled before the overlap check runs.
  const portals = new MutationObserver(() => schedule(300))
  portals.observe(document.body, { childList: true })
  onCleanup(() => portals.disconnect())
  const appearance = new MutationObserver(() => schedule(300))
  appearance.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-theme"] })
  onCleanup(() => appearance.disconnect())
  createEventListener(window.matchMedia("(prefers-color-scheme: dark)"), "change", () => schedule(300))
  createEventListener(document, "visibilitychange", () => setStore("visible", document.visibilityState === "visible"))
  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    clearTimeout(release)
    capturing = undefined
    replaceSnapshot()
  })

  return (
    <aside id="browser-panel" class="relative size-full min-w-0 overflow-hidden bg-v2-background-bg-base flex flex-col">
      <div class="h-10 shrink-0 flex items-center gap-1 px-3 border-b border-v2-border-border-muted">
        <For each={["back", "forward"] as const}>
          {(direction) => (
            <Tooltip placement="top" value={language.t(direction === "back" ? "common.goBack" : "common.goForward")}>
              <IconButton
                {...button}
                disabled={!state()?.[direction === "back" ? "canGoBack" : "canGoForward"]}
                aria-label={language.t(direction === "back" ? "common.goBack" : "common.goForward")}
                onClick={() => {
                  const tab = state()
                  if (tab) props.browser.command({ type: direction, tabID: tab.id })
                }}
                icon={
                  <Icon
                    name={direction === "back" ? "chevron-left" : "chevron-right"}
                    size="small"
                    class="rtl:rotate-180"
                  />
                }
              />
            </Tooltip>
          )}
        </For>
        <Tooltip
          placement="top"
          value={
            <div class="flex items-center gap-2">
              <span>{language.t(state()?.loading ? "prompt.action.stop" : "error.page.action.reload")}</span>
              <Show when={!state()?.loading}>
                <Keybind keys={command.keybindParts("browser.reload")} variant="neutral" />
              </Show>
            </div>
          }
        >
          <IconButton
            {...button}
            disabled={!state()?.loading && !address()}
            aria-label={language.t(state()?.loading ? "prompt.action.stop" : "error.page.action.reload")}
            onClick={() => {
              const tab = state()
              if (tab) props.browser.command({ type: tab.loading ? "stop" : "reload", tabID: tab.id })
            }}
            icon={
              <Show when={state()?.loading} fallback={<Icon name="refresh" size="small" />}>
                <Loader />
              </Show>
            }
          />
        </Tooltip>
        <Show when={props.onComment}>
          <Tooltip
            placement="top"
            value={
              <div class="flex flex-col gap-1">
                <div class="flex items-center gap-2">
                  <span>{language.t("session.browser.inspect")}</span>
                  <Show when={command.keybindParts("browser.inspect").length > 0}>
                    <Keybind keys={command.keybindParts("browser.inspect")} variant="neutral" />
                  </Show>
                </div>
                {/* The page claims Chromium's picker chord itself; the app leaves it to the terminal. */}
                <div class="flex items-center gap-2">
                  <span>{language.t("session.browser.inspect.pageShortcut")}</span>
                  <Keybind keys={formatKeybindParts("mod+shift+c", language.t)} variant="neutral" />
                </div>
              </div>
            }
          >
            {/* The ghost variant sets the button color, so the active accent needs precedence over it. */}
            <IconButton
              {...button}
              data-action="browser-inspect"
              disabled={!inspectable()}
              state={picking() ? "pressed" : undefined}
              classList={{ "!text-v2-icon-icon-accent": picking() || !!store.comment }}
              aria-pressed={picking()}
              aria-label={language.t("session.browser.inspect")}
              onClick={toggleInspect}
              icon={<Icon name="select-element" size="small" />}
            />
          </Tooltip>
        </Show>
        <form
          dir="ltr"
          class="relative min-w-0 flex-1 h-7 rounded-md hover:bg-v2-overlay-simple-overlay-hover focus-within:bg-v2-overlay-simple-overlay-hover text-12-regular"
          onSubmit={(event) => {
            event.preventDefault()
            const tab = state()
            const url = store.address.trim()
            if (!tab) return
            if (url || failed()) {
              setStore({ submitted: true, address: url, navigating: true })
              props.browser.command({ type: "navigate", tabID: tab.id, url: url || "about:blank" })
            }
            event.currentTarget.querySelector("input")?.blur()
          }}
        >
          <input
            class="w-full h-full px-2 rounded-md border border-transparent bg-transparent text-transparent caret-v2-text-text-base placeholder:text-v2-text-text-faint outline-none focus:border-v2-border-border-focus"
            spellcheck={false}
            autocomplete="off"
            value={store.address}
            disabled={!state()}
            placeholder={language.t("session.browser.address.placeholder")}
            aria-label={language.t("session.browser.address")}
            onFocus={(event) => {
              setStore("editing", true)
              event.currentTarget.select()
            }}
            onClick={(event) => event.currentTarget.select()}
            onBlur={() =>
              setStore({ editing: false, address: store.submitted ? store.address : address(), submitted: false })
            }
            onInput={(event) => setStore("address", event.currentTarget.value)}
            onScroll={(event) => {
              if (addressDisplay) addressDisplay.scrollLeft = event.currentTarget.scrollLeft
            }}
          />
          {/* Keep native input editing and selection while coloring the scheme, including during editing. */}
          <div
            aria-hidden="true"
            class="absolute inset-0 flex items-center px-2 border border-transparent pointer-events-none"
          >
            <div ref={addressDisplay} class="w-full overflow-hidden whitespace-pre text-v2-text-text-base">
              <span class="text-v2-text-text-muted">{scheme()}</span>
              {store.address.slice(scheme().length)}
            </div>
          </div>
        </form>
      </div>
      <Show when={error() && !failed()}>
        <div
          class="shrink-0 px-3 py-1.5 text-12-regular text-text-danger-base border-b border-v2-border-border-muted"
          role="alert"
          aria-live="assertive"
        >
          {error()}
        </div>
      </Show>
      <div ref={surface} class="relative min-h-0 flex-1 bg-v2-background-bg-base flex items-center justify-center">
        <Show when={store.snapshot?.tabID === state()?.id && !empty() && !failed() && store.snapshot?.url}>
          {(url) => (
            <img
              src={url()}
              alt=""
              draggable={false}
              class="absolute inset-0 size-full pointer-events-none select-none"
            />
          )}
        </Show>
        <Show when={(empty() || failed()) && !props.browser.suspended()}>
          {/* Add the 40px toolbar to the file empty state's 160px bottom padding to align their centers. */}
          <div
            dir="auto"
            class="flex size-full flex-col items-center justify-center gap-2 p-6 pb-[200px] text-center text-text-weak"
          >
            <Icon name="globe" size="large" class="mb-2 shrink-0" />
            <div class="text-[13px] font-medium leading-[var(--line-height-compact)] text-text-strong">
              {language.t(failed() ? "session.browser.failed.title" : "session.browser.empty.title")}
            </div>
            <div class="text-13-regular leading-[var(--line-height-base)]">
              {language.t(failed() ? "session.browser.failed.description" : "session.browser.empty.description")}
            </div>
          </div>
        </Show>
        <Show when={props.browser.suspended()}>
          <p class="px-6 text-center text-13-regular text-v2-text-text-subtle" role="status">
            {language.t("session.browser.suspended")}
          </p>
        </Show>
        <Show when={store.comment?.tabID === state()?.id && store.comment}>
          {(current) => (
            <div
              data-component="browser-comment"
              class="absolute inset-0 z-10"
              onPointerDown={(event) => {
                // A click beside the editor dismisses it unless it would discard a draft.
                if (event.target === event.currentTarget && !current().draft.trim()) closeComment()
              }}
            >
              <Show when={spotlight()}>
                {(rect) => (
                  <div
                    data-slot="browser-comment-spotlight"
                    class="pointer-events-none absolute rounded-[2px]"
                    style={{
                      left: `${rect().x}px`,
                      top: `${rect().y}px`,
                      width: `${rect().width}px`,
                      height: `${rect().height}px`,
                    }}
                  />
                )}
              </Show>
              <Show when={placement()}>
                {(position) => (
                  <div
                    ref={(element) =>
                      createResizeObserver(element, (rect) => setStore("editorHeight", Math.ceil(rect.height)))
                    }
                    data-slot="browser-comment-editor"
                    data-prevent-autofocus
                    class="absolute overflow-y-auto rounded-[6px] shadow-[var(--v2-elevation-raised)]"
                    style={{
                      left: `${position().left}px`,
                      top: `${position().top}px`,
                      width: `${position().width}px`,
                      "max-height": `${position().maxHeight}px`,
                    }}
                  >
                    <LineCommentEditor
                      value={current().draft}
                      onInput={(value) => setStore("comment", "draft", value)}
                      onCancel={closeComment}
                      onSubmit={submitComment}
                      mention={props.mention}
                      selection={
                        <span class="flex min-w-0 items-center gap-1" dir="ltr">
                          <Icon name="select-element" size="small" class="shrink-0" />
                          <span class="min-w-0 truncate leading-[var(--line-height-tight)]">
                            {current().element.label}
                          </span>
                        </span>
                      }
                    />
                  </div>
                )}
              </Show>
            </div>
          )}
        </Show>
      </div>
      <p class="sr-only" role="status" aria-live="polite">
        {picking() ? language.t("session.browser.inspect.active") : ""}
      </p>
    </aside>
  )
}
