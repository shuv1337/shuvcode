import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  ParentProps,
  Show,
  Switch,
  type JSX,
} from "solid-js"
import { DateTime } from "luxon"
import { A, useNavigate, useParams } from "@solidjs/router"
import { useLayout, getAvatarColors, LocalProject } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { base64Decode, base64Encode } from "@opencode-ai/util/encode"
import { AsciiLogo, AsciiMark } from "@opencode-ai/ui/logo"
import { ThemePicker } from "@/components/theme-picker"
import { FontPicker } from "@/components/font-picker"
import { Select } from "@opencode-ai/ui/select"
import { Avatar } from "@opencode-ai/ui/avatar"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { DiffChanges } from "@opencode-ai/ui/diff-changes"
import { Spinner } from "@opencode-ai/ui/spinner"
import { getFilename } from "@opencode-ai/util/path"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Session } from "@opencode-ai/sdk/v2/client"
import { usePlatform } from "@/context/platform"
import { createStore, produce } from "solid-js/store"
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  closestCenter,
  createSortable,
} from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { useProviders } from "@/hooks/use-providers"
import { showToast, Toast } from "@opencode-ai/ui/toast"
import { useGlobalSDK } from "@/context/global-sdk"
import { useNotification } from "@/context/notification"
import { Binary } from "@opencode-ai/util/binary"
import { PullToRefresh } from "@/components/pull-to-refresh"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogSelectProvider } from "@/components/dialog-select-provider"
import { DialogCreateProject } from "@/components/dialog-create-project"
import { useCommand } from "@/context/command"
import { ConstrainDragXAxis } from "@/utils/solid-dnd"

export default function Layout(props: ParentProps) {
  const [store, setStore] = createStore({
    lastSession: {} as { [directory: string]: string },
    activeDraggable: undefined as string | undefined,
    mobileMenuOpen: false,
  })

  let scrollContainerRef: HTMLDivElement | undefined

  const params = useParams()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const layout = useLayout()
  const platform = usePlatform()
  const notification = useNotification()
  const navigate = useNavigate()
  const providers = useProviders()
  const dialog = useDialog()
  const command = useCommand()

  onMount(async () => {
    if (platform.checkUpdate && platform.update && platform.restart) {
      const { updateAvailable, version } = await platform.checkUpdate()
      if (updateAvailable) {
        showToast({
          persistent: true,
          icon: "download",
          title: "Update available",
          description: `A new version of OpenCode (${version}) is now available to install.`,
          actions: [
            {
              label: "Install and restart",
              onClick: async () => {
                await platform.update!()
                await platform.restart!()
              },
            },
            {
              label: "Not yet",
              onClick: "dismiss",
            },
          ],
        })
      }
    }
  })

  // Header helpers
  const currentDirectory = createMemo(() => base64Decode(params.dir ?? ""))
  const sessions = createMemo(() => {
    const dir = currentDirectory()
    if (!dir) return []
    return globalSync.child(dir)[0].session ?? []
  })
  const currentSession = createMemo(() => sessions().find((s) => s.id === params.id))
  const currentSessionId = createMemo(() => currentSession()?.id)
  const otherSessions = createMemo(() => sessions().filter((s) => s.id !== currentSessionId()))

  function flattenSessions(sessions: Session[]): Session[] {
    const childrenMap = new Map<string, Session[]>()
    for (const session of sessions) {
      if (session.parentID) {
        const children = childrenMap.get(session.parentID) ?? []
        children.push(session)
        childrenMap.set(session.parentID, children)
      }
    }
    const result: Session[] = []
    function visit(session: Session) {
      result.push(session)
      for (const child of childrenMap.get(session.id) ?? []) {
        visit(child)
      }
    }
    for (const session of sessions) {
      if (!session.parentID) visit(session)
    }
    return result
  }

  function scrollToSession(sessionId: string) {
    if (!scrollContainerRef) return
    const element = scrollContainerRef.querySelector(`[data-session-id="${sessionId}"]`)
    if (element) {
      element.scrollIntoView({ block: "center", behavior: "smooth" })
    }
  }

  function projectSessions(directory: string) {
    if (!directory) return []
    const sessions = globalSync
      .child(directory)[0]
      .session.toSorted((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
    return flattenSessions(sessions ?? [])
  }

  const currentSessions = createMemo(() => {
    if (!params.dir) return []
    const directory = base64Decode(params.dir)
    return projectSessions(directory)
  })

  function navigateSessionByOffset(offset: number) {
    const projects = layout.projects.list()
    if (projects.length === 0) return

    const currentDirectory = params.dir ? base64Decode(params.dir) : undefined
    const projectIndex = currentDirectory ? projects.findIndex((p) => p.worktree === currentDirectory) : -1

    if (projectIndex === -1) {
      const targetProject = offset > 0 ? projects[0] : projects[projects.length - 1]
      if (targetProject) navigateToProject(targetProject.worktree)
      return
    }

    const sessions = currentSessions()
    const sessionIndex = params.id ? sessions.findIndex((s) => s.id === params.id) : -1

    let targetIndex: number
    if (sessionIndex === -1) {
      targetIndex = offset > 0 ? 0 : sessions.length - 1
    } else {
      targetIndex = sessionIndex + offset
    }

    if (targetIndex >= 0 && targetIndex < sessions.length) {
      const session = sessions[targetIndex]
      navigateToSession(session)
      queueMicrotask(() => scrollToSession(session.id))
      return
    }

    const nextProjectIndex = projectIndex + (offset > 0 ? 1 : -1)
    const nextProject = projects[nextProjectIndex]
    if (!nextProject) return

    const nextProjectSessions = projectSessions(nextProject.worktree)
    if (nextProjectSessions.length === 0) {
      navigateToProject(nextProject.worktree)
      return
    }

    const targetSession = offset > 0 ? nextProjectSessions[0] : nextProjectSessions[nextProjectSessions.length - 1]
    navigate(`/${base64Encode(nextProject.worktree)}/session/${targetSession.id}`)
    queueMicrotask(() => scrollToSession(targetSession.id))
  }

  async function archiveSession(session: Session) {
    const [store, setStore] = globalSync.child(session.directory)
    const sessions = store.session ?? []
    const index = sessions.findIndex((s) => s.id === session.id)
    const nextSession = sessions[index + 1] ?? sessions[index - 1]

    await globalSDK.client.session.update({
      directory: session.directory,
      sessionID: session.id,
      time: { archived: Date.now() },
    })
    setStore(
      produce((draft) => {
        const match = Binary.search(draft.session, session.id, (s) => s.id)
        if (match.found) draft.session.splice(match.index, 1)
      }),
    )
    if (session.id === params.id) {
      if (nextSession) {
        navigate(`/${params.dir}/session/${nextSession.id}`)
      } else {
        navigate(`/${params.dir}/session`)
      }
    }
  }

  command.register(() => [
    {
      id: "sidebar.toggle",
      title: "Toggle sidebar",
      category: "View",
      keybind: "mod+b",
      onSelect: () => layout.sidebar.toggle(),
    },
    ...(platform.openDirectoryPickerDialog
      ? [
          {
            id: "project.open",
            title: "Open project",
            category: "Project",
            keybind: "mod+o",
            onSelect: () => chooseProject(),
          },
        ]
      : []),
    {
      id: "provider.connect",
      title: "Connect provider",
      category: "Provider",
      onSelect: () => connectProvider(),
    },
    {
      id: "session.previous",
      title: "Previous session",
      category: "Session",
      keybind: "alt+arrowup",
      onSelect: () => navigateSessionByOffset(-1),
    },
    {
      id: "session.next",
      title: "Next session",
      category: "Session",
      keybind: "alt+arrowdown",
      onSelect: () => navigateSessionByOffset(1),
    },
    {
      id: "session.archive",
      title: "Archive session",
      category: "Session",
      keybind: "mod+shift+backspace",
      disabled: !params.dir || !params.id,
      onSelect: () => {
        const session = currentSessions().find((s) => s.id === params.id)
        if (session) archiveSession(session)
      },
    },
  ])

  function connectProvider() {
    dialog.show(() => <DialogSelectProvider />)
  }

  function createProject() {
    dialog.show(() => <DialogCreateProject />)
  }

  function navigateToProject(directory: string | undefined) {
    if (!directory) return
    const lastSession = store.lastSession[directory]
    navigate(`/${base64Encode(directory)}${lastSession ? `/session/${lastSession}` : ""}`)
  }

  function navigateToSession(session: Session | undefined) {
    if (!session) return
    navigate(`/${params.dir}/session/${session?.id}`)
  }

  function openProject(directory: string, navigate = true) {
    layout.projects.open(directory)
    if (navigate) navigateToProject(directory)
  }

  function closeProject(directory: string) {
    const index = layout.projects.list().findIndex((x) => x.worktree === directory)
    const next = layout.projects.list()[index + 1]
    layout.projects.close(directory)
    if (next) navigateToProject(next.worktree)
    else navigate("/")
  }

  async function chooseProject() {
    const result = await platform.openDirectoryPickerDialog?.({
      title: "Open project",
      multiple: true,
    })
    if (Array.isArray(result)) {
      for (const directory of result) {
        openProject(directory, false)
      }
      navigateToProject(result[0])
    } else if (result) {
      openProject(result)
    }
  }

  createEffect(() => {
    if (!params.dir || !params.id) return
    const directory = base64Decode(params.dir)
    setStore("lastSession", directory, params.id)
    notification.session.markViewed(params.id)
  })

  createEffect(() => {
    const sidebarWidth = layout.sidebar.opened() ? layout.sidebar.width() : 48
    document.documentElement.style.setProperty("--dialog-left-margin", `${sidebarWidth}px`)
  })

  function getDraggableId(event: unknown): string | undefined {
    if (typeof event !== "object" || event === null) return undefined
    if (!("draggable" in event)) return undefined
    const draggable = (event as { draggable?: { id?: unknown } }).draggable
    if (!draggable) return undefined
    return typeof draggable.id === "string" ? draggable.id : undefined
  }

  function handleDragStart(event: unknown) {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeDraggable", id)
  }

  function handleDragOver(event: DragEvent) {
    const { draggable, droppable } = event
    if (draggable && droppable) {
      const projects = layout.projects.list()
      const fromIndex = projects.findIndex((p) => p.worktree === draggable.id.toString())
      const toIndex = projects.findIndex((p) => p.worktree === droppable.id.toString())
      if (fromIndex !== toIndex && toIndex !== -1) {
        layout.projects.move(draggable.id.toString(), toIndex)
      }
    }
  }

  function handleDragEnd() {
    setStore("activeDraggable", undefined)
  }

  const ProjectAvatar = (props: {
    project: LocalProject
    class?: string
    expandable?: boolean
    notify?: boolean
  }): JSX.Element => {
    const notification = useNotification()
    const notifications = createMemo(() => notification.project.unseen(props.project.worktree))
    const hasError = createMemo(() => notifications().some((n) => n.type === "error"))
    const name = createMemo(() => getFilename(props.project.worktree))
    const mask = "radial-gradient(circle 5px at calc(100% - 2px) 2px, transparent 5px, black 5.5px)"
    const opencode = "4b0ea68d7af9a6031a7ffda7ad66e0cb83315750"

    return (
      <div class="relative size-5 shrink-0 rounded-sm">
        <Avatar
          fallback={name()}
          src={props.project.id === opencode ? "https://opencode.ai/favicon.svg" : props.project.icon?.url}
          {...getAvatarColors(props.project.icon?.color)}
          class={`size-full ${props.class ?? ""}`}
          style={
            notifications().length > 0 && props.notify ? { "-webkit-mask-image": mask, "mask-image": mask } : undefined
          }
        />
        <Show when={props.expandable}>
          <Icon
            name="chevron-right"
            size="normal"
            class="hidden size-full items-center justify-center text-text-subtle group-hover/session:flex group-data-[expanded]/trigger:rotate-90 transition-transform duration-50"
          />
        </Show>
        <Show when={notifications().length > 0 && props.notify}>
          <div
            classList={{
              "absolute -top-0.5 -right-0.5 size-1.5 rounded-full": true,
              "bg-icon-critical-base": hasError(),
              "bg-text-interactive-base": !hasError(),
            }}
          />
        </Show>
      </div>
    )
  }

  const ProjectVisual = (props: { project: LocalProject; class?: string }): JSX.Element => {
    const name = createMemo(() => getFilename(props.project.worktree))
    const current = createMemo(() => base64Decode(params.dir ?? ""))
    return (
      <Switch>
        <Match when={layout.sidebar.opened()}>
          <Button
            as={"div"}
            variant="ghost"
            data-active
            class="flex items-center justify-between gap-3 w-full px-1 self-stretch h-8 border-none rounded-lg"
          >
            <div class="flex items-center gap-3 p-0 text-left min-w-0 grow">
              <ProjectAvatar project={props.project} />
              <span class="truncate text-14-medium text-text-strong">{name()}</span>
            </div>
          </Button>
        </Match>
        <Match when={true}>
          <Button
            variant="ghost"
            size="large"
            class="flex items-center justify-center p-0 aspect-square border-none rounded-lg"
            data-selected={props.project.worktree === current()}
            onClick={() => navigateToProject(props.project.worktree)}
          >
            <ProjectAvatar project={props.project} notify />
          </Button>
        </Match>
      </Switch>
    )
  }

  const SessionItem = (props: {
    session: Session
    slug: string
    project: LocalProject
    depth?: number
    childrenMap: Map<string, Session[]>
  }): JSX.Element => {
    const notification = useNotification()
    const depth = props.depth ?? 0
    const children = createMemo(() => props.childrenMap.get(props.session.id) ?? [])
    const updated = createMemo(() => DateTime.fromMillis(props.session.time.updated))
    const notifications = createMemo(() => notification.session.unseen(props.session.id))
    const hasError = createMemo(() => notifications().some((n) => n.type === "error"))
    const isWorking = createMemo(() => {
      if (props.session.id === params.id) return false
      const status = globalSync.child(props.project.worktree)[0].session_status[props.session.id]
      return status?.type === "busy" || status?.type === "retry"
    })
    return (
      <>
        <div
          data-session-id={props.session.id}
          class="group/session relative w-full pr-2 py-1 rounded-md cursor-default transition-colors
                 hover:bg-surface-raised-base-hover focus-within:bg-surface-raised-base-hover has-[.active]:bg-surface-raised-base-hover"
          style={{ "padding-left": `${16 + depth * 12}px` }}
        >
          <Tooltip placement="right" value={props.session.title} gutter={10}>
            <A
              href={`${props.slug}/session/${props.session.id}`}
              class="flex flex-col min-w-0 text-left w-full focus:outline-none"
            >
              <div class="flex items-center self-stretch gap-6 justify-between transition-[padding] group-hover/session:pr-7 group-focus-within/session:pr-7 group-active/session:pr-7">
                <span class="text-14-regular text-text-strong overflow-hidden text-ellipsis truncate">
                  {props.session.title}
                </span>
                <div class="shrink-0 group-hover/session:hidden group-active/session:hidden group-focus-within/session:hidden">
                  <Switch>
                    <Match when={isWorking()}>
                      <Spinner class="size-2.5 mr-0.5" />
                    </Match>
                    <Match when={hasError()}>
                      <div class="size-1.5 mr-1.5 rounded-full bg-text-diff-delete-base" />
                    </Match>
                    <Match when={notifications().length > 0}>
                      <div class="size-1.5 mr-1.5 rounded-full bg-text-interactive-base" />
                    </Match>
                    <Match when={true}>
                      <span class="text-12-regular text-text-weak text-right whitespace-nowrap">
                        {Math.abs(updated().diffNow().as("seconds")) < 60
                          ? "Now"
                          : updated()
                              .toRelative({
                                style: "short",
                                unit: ["days", "hours", "minutes"],
                              })
                              ?.replace(" ago", "")
                              ?.replace(/ days?/, "d")
                              ?.replace(" min.", "m")
                              ?.replace(" hr.", "h")}
                      </span>
                    </Match>
                  </Switch>
                </div>
              </div>
              <Show when={props.session.summary?.files}>
                <div class="flex justify-between items-center self-stretch">
                  <span class="text-12-regular text-text-weak">{`${props.session.summary?.files || "No"} file${props.session.summary?.files !== 1 ? "s" : ""} changed`}</span>
                  <Show when={props.session.summary}>{(summary) => <DiffChanges changes={summary()} />}</Show>
                </div>
              </Show>
            </A>
          </Tooltip>
          <div class="hidden group-hover/session:flex group-active/session:flex group-focus-within/session:flex text-text-base gap-1 items-center absolute top-1 right-1">
            <Tooltip placement="right" value="Archive session">
              <IconButton icon="archive" variant="ghost" onClick={() => archiveSession(props.session)} />
            </Tooltip>
          </div>
        </div>
        <For each={children()}>
          {(child) => (
            <SessionItem
              session={child}
              slug={props.slug}
              project={props.project}
              depth={depth + 1}
              childrenMap={props.childrenMap}
            />
          )}
        </For>
      </>
    )
  }

  const SortableProject = (props: { project: LocalProject }): JSX.Element => {
    const sortable = createSortable(props.project.worktree)
    const slug = createMemo(() => base64Encode(props.project.worktree))
    const name = createMemo(() => getFilename(props.project.worktree))
    const [store, setProjectStore] = globalSync.child(props.project.worktree)
    const sessions = createMemo(() =>
      store.session.toSorted((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created)),
    )
    const rootSessions = createMemo(() => sessions().filter((s) => !s.parentID))
    const childSessionsByParent = createMemo(() => {
      const map = new Map<string, Session[]>()
      for (const session of sessions()) {
        if (session.parentID) {
          const children = map.get(session.parentID) ?? []
          children.push(session)
          map.set(session.parentID, children)
        }
      }
      return map
    })
    const hasMoreSessions = createMemo(() => store.session.length >= store.limit)
    const loadMoreSessions = async () => {
      setProjectStore("limit", (limit) => limit + 5)
      await globalSync.project.loadSessions(props.project.worktree)
    }
    const handleOpenChange = (open: boolean) => {
      if (open) layout.projects.expand(props.project.worktree)
      else layout.projects.collapse(props.project.worktree)
    }
    return (
      // @ts-ignore
      <div use:sortable classList={{ "opacity-30": sortable.isActiveDraggable }}>
        <Switch>
          <Match when={layout.sidebar.opened()}>
            <Collapsible
              variant="ghost"
              open={props.project.expanded}
              class="gap-2 shrink-0"
              onOpenChange={handleOpenChange}
            >
              <Button
                as={"div"}
                variant="ghost"
                class="group/session flex items-center justify-between gap-3 w-full px-1.5 self-stretch h-auto border-none rounded-lg"
              >
                <Collapsible.Trigger class="group/trigger flex items-center gap-3 p-0 text-left min-w-0 grow border-none">
                  <ProjectAvatar
                    project={props.project}
                    class="group-hover/session:hidden"
                    expandable
                    notify={!props.project.expanded}
                  />
                  <span class="truncate text-14-medium text-text-strong">{name()}</span>
                </Collapsible.Trigger>
                <div class="flex invisible gap-1 items-center group-hover/session:visible has-[[data-expanded]]:visible">
                  <DropdownMenu>
                    <DropdownMenu.Trigger as={IconButton} icon="dot-grid" variant="ghost" />
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content>
                        <DropdownMenu.Item onSelect={() => closeProject(props.project.worktree)}>
                          <DropdownMenu.ItemLabel>Close Project</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu>
                  <Tooltip placement="top" value="New session">
                    <IconButton as={A} href={`${slug()}/session`} icon="plus-small" variant="ghost" />
                  </Tooltip>
                </div>
              </Button>
              <Collapsible.Content>
                <nav class="hidden @[4rem]:flex w-full flex-col gap-1.5">
                  <For each={rootSessions()}>
                    {(session) => (
                      <SessionItem
                        session={session}
                        slug={slug()}
                        project={props.project}
                        childrenMap={childSessionsByParent()}
                      />
                    )}
                  </For>
                  <Show when={rootSessions().length === 0}>
                    <div
                      class="group/session relative w-full pl-4 pr-2 py-1 rounded-md cursor-default transition-colors
                             hover:bg-surface-raised-base-hover focus-within:bg-surface-raised-base-hover has-[.active]:bg-surface-raised-base-hover"
                    >
                      <div class="flex items-center self-stretch w-full">
                        <div class="flex-1 min-w-0">
                          <Tooltip placement="right" value="New session">
                            <A
                              href={`${slug()}/session`}
                              class="flex flex-col gap-1 min-w-0 text-left w-full focus:outline-none"
                            >
                              <div class="flex items-center self-stretch gap-6 justify-between">
                                <span class="text-14-regular text-text-strong overflow-hidden text-ellipsis truncate">
                                  New session
                                </span>
                              </div>
                            </A>
                          </Tooltip>
                        </div>
                      </div>
                    </div>
                  </Show>
                  <Show when={hasMoreSessions()}>
                    <div class="relative w-full py-1">
                      <Button
                        variant="ghost"
                        class="flex w-full text-left justify-start text-12-medium opacity-50 px-3.5"
                        size="large"
                        onClick={loadMoreSessions}
                      >
                        Load more
                      </Button>
                    </div>
                  </Show>
                </nav>
              </Collapsible.Content>
            </Collapsible>
          </Match>
          <Match when={true}>
            <Tooltip placement="right" value={props.project.worktree}>
              <ProjectVisual project={props.project} />
            </Tooltip>
          </Match>
        </Switch>
      </div>
    )
  }

  const ProjectDragOverlay = (): JSX.Element => {
    const project = createMemo(() => layout.projects.list().find((p) => p.worktree === store.activeDraggable))
    return (
      <Show when={project()}>
        {(p) => (
          <div class="bg-background-base rounded-md">
            <ProjectVisual project={p()} />
          </div>
        )}
      </Show>
    )
  }

  return (
    <div class="relative flex-1 min-h-0 flex flex-col bg-background-base">
      <header class="flex flex-col shrink-0 bg-background-base border-b border-border-weak-base" data-tauri-drag-region>
        <div class="pt-safe-top" />
        <div class="flex h-12">
          {/* Mobile hamburger menu button */}
          <button
            class="w-12 shrink-0 flex sm:hidden items-center justify-center self-stretch border-r border-border-weak-base"
            onClick={() => setStore("mobileMenuOpen", true)}
            aria-label="Open menu"
          >
            <Icon name="menu" size="normal" />
          </button>
          <A
            href="/"
            classList={{
              "w-12 shrink-0": true,
              "items-center justify-center self-stretch overflow-hidden": true,
              "border-r border-border-weak-base": true,
              "hidden sm:flex": !layout.sidebar.opened(),
              flex: layout.sidebar.opened(),
            }}
            style={{ width: layout.sidebar.opened() ? `${layout.sidebar.width()}px` : undefined }}
            data-tauri-drag-region
          >
            <Show when={layout.sidebar.opened()} fallback={<AsciiMark scale={0.45} />}>
              <AsciiLogo scale={0.55} />
            </Show>
          </A>
          <div class="pl-4 px-6 flex items-center justify-between gap-4 w-full">
            <Show
              when={params.dir && layout.projects.list().length > 0}
              fallback={
                <div class="hidden sm:flex items-center gap-2 ml-auto">
                  <FontPicker />
                  <ThemePicker />
                </div>
              }
            >
              <div class="flex items-center gap-3 min-w-0 grow flex-nowrap">
                <div class="hidden sm:flex items-center gap-2 min-w-0">
                  <Select
                    options={layout.projects.list().map((project) => project.worktree)}
                    current={currentDirectory()}
                    label={(x) => getFilename(x)}
                    onSelect={(x) => (x ? navigateToProject(x) : undefined)}
                    class="text-14-regular text-text-base"
                    rootClass="min-w-0 shrink"
                    variant="ghost"
                    size="large"
                  >
                    {/* @ts-ignore */}
                    {(i) => (
                      <div class="flex items-center gap-2 min-w-0">
                        <Icon name="folder" size="small" class="shrink-0" />
                        <div class="text-text-strong truncate">{getFilename(i)}</div>
                      </div>
                    )}
                  </Select>
                  <div class="text-text-weaker">/</div>
                </div>
                <div class="flex items-center min-w-0 sm:hidden">
                  <DropdownMenu>
                    <DropdownMenu.Trigger
                      as={Button}
                      variant="ghost"
                      size="large"
                      class="flex-1 justify-between gap-3 min-w-0 text-14-regular text-text-base"
                    >
                      <span class="truncate text-text-base lowercase">session</span>
                      <Icon name="chevron-down" size="small" class="shrink-0 text-icon-base" />
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content class="max-w-[calc(100vw-2rem)]">
                        <div class="flex flex-col gap-1 py-1">
                          <DropdownMenu.Item onSelect={() => navigate(`/${params.dir}/session`)}>
                            <DropdownMenu.ItemLabel>
                              <div class="flex items-center gap-2 min-w-0">
                                <Icon name="plus-small" size="small" class="shrink-0 text-icon-base" />
                                <span class="truncate">New session</span>
                              </div>
                            </DropdownMenu.ItemLabel>
                            <Show when={!currentSessionId()}>
                              <DropdownMenu.ItemIndicator>
                                <Icon name="check-small" size="small" />
                              </DropdownMenu.ItemIndicator>
                            </Show>
                          </DropdownMenu.Item>
                          <Show when={currentSession()}>
                            {(session) => (
                              <DropdownMenu.Item onSelect={() => navigateToSession(session())}>
                                <DropdownMenu.ItemLabel class="min-w-0">
                                  <div class="flex items-center gap-2 min-w-0">
                                    <Icon name="dot-grid" size="small" class="shrink-0 text-icon-base" />
                                    <div class="flex flex-col min-w-0">
                                      <span class="truncate">{session().title}</span>
                                      <span class="text-12-regular text-text-weak">Current session</span>
                                    </div>
                                  </div>
                                </DropdownMenu.ItemLabel>
                                <DropdownMenu.ItemIndicator>
                                  <Icon name="check-small" size="small" />
                                </DropdownMenu.ItemIndicator>
                              </DropdownMenu.Item>
                            )}
                          </Show>
                        </div>
                        <Show when={otherSessions().length}>
                          <DropdownMenu.Separator />
                          <div class="flex flex-col gap-1 max-h-60 overflow-y-auto pr-1">
                            <For each={otherSessions()}>
                              {(session) => (
                                <DropdownMenu.Item onSelect={() => navigateToSession(session)}>
                                  <DropdownMenu.ItemLabel class="min-w-0">
                                    <div class="flex items-center gap-2 min-w-0">
                                      <span class="truncate">{session.title}</span>
                                    </div>
                                  </DropdownMenu.ItemLabel>
                                </DropdownMenu.Item>
                              )}
                            </For>
                          </div>
                        </Show>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu>
                </div>
                {/* Mobile review button - shows file count when there are changes */}
                <Show when={layout.mobileReview.visible()}>
                  <button
                    class="sm:hidden flex items-center gap-2 px-3 h-full text-14-medium text-text-strong"
                    onClick={() => layout.mobileReview.onOpen()?.()}
                  >
                    <Show when={layout.mobileReview.filesCount() > 0}>
                      <span class="text-12-medium h-5 px-2 flex items-center justify-center rounded-full bg-surface-base">
                        {layout.mobileReview.filesCount()}
                      </span>
                    </Show>
                    <span>Review</span>
                    <Icon name="chevron-right" size="small" class="text-icon-base" />
                  </button>
                </Show>
                <Show when={currentSession()}>
                  <Button
                    as={A}
                    href={`/${params.dir}/session`}
                    icon="plus-small"
                    class="hidden sm:inline-flex shrink-0 whitespace-nowrap order-2 sm:order-none"
                  >
                    New session
                  </Button>
                </Show>
                <div class="hidden sm:flex items-center gap-2 min-w-0 sm:max-w-md sm:flex-1">
                  <Select
                    options={sessions()}
                    current={currentSession()}
                    placeholder="New session"
                    label={(x) => x.title}
                    value={(x) => x.id}
                    onSelect={navigateToSession}
                    class="text-14-regular text-text-base"
                    rootClass="min-w-0 grow basis-full sm:basis-auto sm:max-w-md"
                    variant="ghost"
                    size="large"
                  >
                    {/* @ts-ignore */}
                    {(session) => <div class="min-w-0 truncate">{session ? session.title : "New session"}</div>}
                  </Select>
                </div>
              </div>
              <div class="hidden sm:flex items-center gap-2 ml-auto">
                <FontPicker />
                <ThemePicker />
              </div>
              <div class="flex items-center gap-2">
                {/* Mobile message navigation */}
                <Show when={layout.mobileMessageNav.visible()}>
                  <div class="sm:hidden">
                    <DropdownMenu>
                      <DropdownMenu.Trigger
                        as={Button}
                        variant="ghost"
                        size="small"
                        class="gap-1 px-2"
                      >
                        <span class="text-12-medium">
                          {layout.mobileMessageNav.currentIndex() + 1}/{layout.mobileMessageNav.messages().length}
                        </span>
                        <Icon name="chevron-down" size="small" />
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content class="max-w-[calc(100vw-2rem)] max-h-80 overflow-y-auto">
                          <For each={layout.mobileMessageNav.messages()}>
                            {(msg, index) => (
                              <DropdownMenu.Item onSelect={() => layout.mobileMessageNav.onSelect()?.(index())}>
                                <DropdownMenu.ItemLabel class="flex items-center gap-3">
                                  <span class="text-text-weak shrink-0">{index() + 1}</span>
                                  <span class="truncate">{msg.title || "Message"}</span>
                                </DropdownMenu.ItemLabel>
                                <Show when={index() === layout.mobileMessageNav.currentIndex()}>
                                  <DropdownMenu.ItemIndicator>
                                    <Icon name="check-small" size="small" />
                                  </DropdownMenu.ItemIndicator>
                                </Show>
                              </DropdownMenu.Item>
                            )}
                          </For>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu>
                  </div>
                </Show>
                <Tooltip
                  class="shrink-0"
                  value={
                    <div class="flex items-center gap-2">
                      <span>Toggle terminal</span>
                      <span class="text-icon-base text-12-medium">Ctrl `</span>
                    </div>
                  }
                >
                  <Button variant="ghost" class="group/terminal-toggle size-6 p-0" onClick={layout.terminal.toggle}>
                    <div class="relative flex items-center justify-center size-4 [&>*]:absolute [&>*]:inset-0">
                      <Icon
                        size="small"
                        name={layout.terminal.opened() ? "layout-bottom-full" : "layout-bottom"}
                        class="group-hover/terminal-toggle:hidden"
                      />
                      <Icon
                        size="small"
                        name="layout-bottom-partial"
                        class="hidden group-hover/terminal-toggle:inline-block"
                      />
                      <Icon
                        size="small"
                        name={layout.terminal.opened() ? "layout-bottom" : "layout-bottom-full"}
                        class="hidden group-active/terminal-toggle:inline-block"
                      />
                    </div>
                  </Button>
                </Tooltip>
              </div>
            </Show>
          </div>
        </div>
      </header>
      <div class="flex-1 min-h-0 flex pl-safe-left pr-safe-right">
        <div
          classList={{
            "relative @container w-12 pb-5 shrink-0 bg-background-base": true,
            "flex-col gap-5.5 items-start self-stretch justify-between": true,
            "border-r border-border-weak-base contain-strict": true,
            "hidden sm:flex": true,
            "sm:!flex": layout.sidebar.opened(),
          }}
          style={{ width: layout.sidebar.opened() ? `${layout.sidebar.width()}px` : undefined }}
        >
          <Show when={layout.sidebar.opened()}>
            <ResizeHandle
              direction="horizontal"
              size={layout.sidebar.width()}
              min={150}
              max={window.innerWidth * 0.3}
              collapseThreshold={80}
              onResize={layout.sidebar.resize}
              onCollapse={layout.sidebar.close}
            />
          </Show>
          <div class="flex flex-col items-start self-stretch gap-4 p-2 min-h-0 overflow-hidden">
            <Tooltip
              class="shrink-0"
              placement="right"
              value={
                <div class="flex items-center gap-2">
                  <span>Toggle sidebar</span>
                  <span class="text-icon-base text-12-medium">{command.keybind("sidebar.toggle")}</span>
                </div>
              }
              inactive={layout.sidebar.opened()}
            >
              <Button
                variant="ghost"
                size="large"
                class="group/sidebar-toggle shrink-0 w-full text-left justify-start rounded-lg px-2"
                onClick={layout.sidebar.toggle}
              >
                <div class="relative -ml-px flex items-center justify-center size-4 [&>*]:absolute [&>*]:inset-0">
                  <Icon
                    name={layout.sidebar.opened() ? "layout-left" : "layout-right"}
                    size="small"
                    class="group-hover/sidebar-toggle:hidden"
                  />
                  <Icon
                    name={layout.sidebar.opened() ? "layout-left-partial" : "layout-right-partial"}
                    size="small"
                    class="hidden group-hover/sidebar-toggle:inline-block"
                  />
                  <Icon
                    name={layout.sidebar.opened() ? "layout-left-full" : "layout-right-full"}
                    size="small"
                    class="hidden group-active/sidebar-toggle:inline-block"
                  />
                </div>
                <Show when={layout.sidebar.opened()}>
                  <div class="text-text-strong">Toggle sidebar</div>
                </Show>
              </Button>
            </Tooltip>
            <DragDropProvider
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
              collisionDetector={closestCenter}
            >
              <DragDropSensors />
              <ConstrainDragXAxis />
              <div
                ref={scrollContainerRef}
                class="w-full min-w-8 flex flex-col gap-2 min-h-0 overflow-y-auto no-scrollbar"
              >
                <SortableProvider ids={layout.projects.list().map((p) => p.worktree)}>
                  <For each={layout.projects.list()}>{(project) => <SortableProject project={project} />}</For>
                </SortableProvider>
              </div>
              <DragOverlay>
                <ProjectDragOverlay />
              </DragOverlay>
            </DragDropProvider>
          </div>
          <div class="flex flex-col gap-1.5 self-stretch items-start shrink-0 px-2 py-3">
            <Switch>
              <Match when={!providers.paid().length && layout.sidebar.opened()}>
                <div class="rounded-md bg-background-stronger shadow-xs-border-base">
                  <div class="p-3 flex flex-col gap-2">
                    <div class="text-12-medium text-text-strong">Getting started</div>
                    <div class="text-text-base">OpenCode includes free models so you can start immediately.</div>
                    <div class="text-text-base">Connect any provider to use models, inc. Claude, GPT, Gemini etc.</div>
                  </div>
                  <Tooltip placement="right" value="Connect provider" inactive={layout.sidebar.opened()}>
                    <Button
                      class="flex w-full text-left justify-start text-12-medium text-text-strong stroke-[1.5px] rounded-lg rounded-t-none shadow-none border-t border-border-weak-base pl-2.25 pb-px"
                      size="large"
                      icon="plus"
                      onClick={connectProvider}
                    >
                      <Show when={layout.sidebar.opened()}>Connect provider</Show>
                    </Button>
                  </Tooltip>
                </div>
              </Match>
              <Match when={true}>
                <Tooltip placement="right" value="Connect provider" inactive={layout.sidebar.opened()}>
                  <Button
                    class="flex w-full text-left justify-start text-text-base stroke-[1.5px] rounded-lg px-2"
                    variant="ghost"
                    size="large"
                    icon="plus"
                    onClick={connectProvider}
                  >
                    <Show when={layout.sidebar.opened()}>Connect provider</Show>
                  </Button>
                </Tooltip>
              </Match>
            </Switch>
            <Show when={platform.openDirectoryPickerDialog}>
              <Tooltip
                placement="right"
                value={
                  <div class="flex items-center gap-2">
                    <span>Open project</span>
                    <span class="text-icon-base text-12-medium">{command.keybind("project.open")}</span>
                  </div>
                }
                inactive={layout.sidebar.opened()}
              >
                <Button
                  class="flex w-full text-left justify-start text-text-base stroke-[1.5px] rounded-lg px-2"
                  variant="ghost"
                  size="large"
                  icon="folder-add-left"
                  onClick={chooseProject}
                >
                  <Show when={layout.sidebar.opened()}>Open project</Show>
                </Button>
              </Tooltip>
            </Show>
            <Tooltip placement="right" value="Create project" inactive={layout.sidebar.opened()}>
              <Button
                class="flex w-full text-left justify-start text-text-base stroke-[1.5px] rounded-lg px-2"
                variant="ghost"
                size="large"
                icon="folder-add-left"
                onClick={createProject}
              >
                <Show when={layout.sidebar.opened()}>Create project</Show>
              </Button>
            </Tooltip>
            {/* <Tooltip placement="right" value="Settings" inactive={layout.sidebar.opened()}> */}
            {/*   <Button */}
            {/*     disabled */}
            {/*     class="flex w-full text-left justify-start text-12-medium text-text-base stroke-[1.5px] rounded-lg px-2" */}
            {/*     variant="ghost" */}
            {/*     size="large" */}
            {/*     icon="settings-gear" */}
            {/*   > */}
            {/*     <Show when={layout.sidebar.opened()}>Settings</Show> */}
            {/*   </Button> */}
            {/* </Tooltip> */}
            <Tooltip placement="right" value="Share feedback" inactive={layout.sidebar.opened()}>
              <Button
                as={"a"}
                href="https://opencode.ai/desktop-feedback"
                target="_blank"
                class="flex w-full text-left justify-start text-text-base stroke-[1.5px] rounded-lg px-2"
                variant="ghost"
                size="large"
                icon="bubble-5"
              >
                <Show when={layout.sidebar.opened()}>Share feedback</Show>
              </Button>
            </Tooltip>
          </div>
          <Show when={layout.sidebar.opened()}>
            <div class="absolute bottom-1 left-2 text-11-regular text-text-weaker">v{__APP_VERSION__} ({__COMMIT_HASH__})</div>
          </Show>
        </div>
        <main class="size-full overflow-x-hidden flex flex-col items-start contain-strict">
          {/* Desktop: direct children, Mobile: wrap in PullToRefresh for swipe-to-refresh */}
          <div class="hidden sm:contents">{props.children}</div>
          <div class="contents sm:hidden">
            <PullToRefresh>{props.children}</PullToRefresh>
          </div>
        </main>
      </div>

      {/* Mobile fullscreen menu overlay */}
      <Show when={store.mobileMenuOpen}>
        <div
          class="fixed inset-0 z-50 sm:hidden flex flex-col bg-background-base"
          style={{
            "padding-top": "var(--safe-area-inset-top)",
            "padding-bottom": "var(--safe-area-inset-bottom)",
            "padding-left": "var(--safe-area-inset-left)",
            "padding-right": "var(--safe-area-inset-right)",
          }}
        >
          {/* Mobile menu header */}
          <div class="h-12 shrink-0 border-b border-border-weak-base flex items-center justify-between px-4">
            <A href="/" class="flex items-center" onClick={() => setStore("mobileMenuOpen", false)}>
              <AsciiLogo scale={0.55} />
            </A>
            <IconButton
              icon="close"
              variant="ghost"
              onClick={() => setStore("mobileMenuOpen", false)}
              aria-label="Close menu"
            />
          </div>

          {/* Mobile menu content */}
          <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            {/* Projects section */}
            <Show when={layout.projects.list().length > 0}>
              <div class="flex flex-col gap-2">
                <div class="text-12-medium text-text-weak uppercase tracking-wide px-2">Projects</div>
                <For each={layout.projects.list()}>
                  {(project) => {
                    const name = () => getFilename(project.worktree)
                    return (
                      <Button
                        variant="ghost"
                        size="large"
                        class="w-full justify-start gap-3 px-2"
                        onClick={() => {
                          navigateToProject(project.worktree)
                          setStore("mobileMenuOpen", false)
                        }}
                      >
                        <ProjectAvatar project={project} notify />
                        <span class="truncate text-14-medium text-text-strong">{name()}</span>
                      </Button>
                    )
                  }}
                </For>
              </div>
            </Show>

            {/* Actions section */}
            <div class="flex flex-col gap-2">
              <div class="text-12-medium text-text-weak uppercase tracking-wide px-2">Actions</div>
              <Button
                variant="ghost"
                size="large"
                class="w-full justify-start gap-3 px-2"
                icon="plus"
                onClick={() => {
                  setStore("mobileMenuOpen", false)
                  connectProvider()
                }}
              >
                <span class="text-14-medium text-text-strong">Connect provider</span>
              </Button>
              <Show when={platform.openDirectoryPickerDialog}>
                <Button
                  variant="ghost"
                  size="large"
                  class="w-full justify-start gap-3 px-2"
                  icon="folder-add-left"
                  onClick={() => {
                    setStore("mobileMenuOpen", false)
                    chooseProject()
                  }}
                >
                  <span class="text-14-medium text-text-strong">Open project</span>
                </Button>
              </Show>
              <Button
                variant="ghost"
                size="large"
                class="w-full justify-start gap-3 px-2"
                icon="folder-add-left"
                onClick={() => {
                  setStore("mobileMenuOpen", false)
                  createProject()
                }}
              >
                <span class="text-14-medium text-text-strong">Create project</span>
              </Button>
              <Button
                as="a"
                href="https://opencode.ai/desktop-feedback"
                target="_blank"
                variant="ghost"
                size="large"
                class="w-full justify-start gap-3 px-2"
                icon="bubble-5"
                onClick={() => setStore("mobileMenuOpen", false)}
              >
                <span class="text-14-medium text-text-strong">Share feedback</span>
              </Button>
            </div>

            {/* Settings section */}
            <div class="flex flex-col gap-2">
              <div class="text-12-medium text-text-weak uppercase tracking-wide px-2">Settings</div>
              <FontPicker mobile />
              <ThemePicker mobile />
            </div>
          </div>

          {/* Mobile menu footer */}
          <div class="shrink-0 border-t border-border-weak-base p-4">
            <div class="text-11-regular text-text-weaker">v{__APP_VERSION__} ({__COMMIT_HASH__})</div>
          </div>
        </div>
      </Show>

      <Toast.Region />
    </div>
  )
}
