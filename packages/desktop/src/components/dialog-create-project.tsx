import { Component, createSignal, createMemo, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLayout } from "@/context/layout"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { Button } from "@opencode-ai/ui/button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { showToast } from "@opencode-ai/ui/toast"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/util/encode"
import { Icon } from "@opencode-ai/ui/icon"
import { usePlatform } from "@/context/platform"
import { useGlobalSync } from "@/context/global-sync"
import { List } from "@opencode-ai/ui/list"

interface DirectoryInfo {
  path: string
  name: string
  isGitRepo: boolean
  isExistingProject: boolean
}

export const DialogCreateProject: Component = () => {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const layout = useLayout()
  const navigate = useNavigate()
  const platform = usePlatform()
  const sync = useGlobalSync()

  const [activeTab, setActiveTab] = createSignal<"create" | "existing">("existing")
  const [selectedDir, setSelectedDir] = createSignal<DirectoryInfo | null>(null)

  const [store, setStore] = createStore({
    path: "",
    error: undefined as string | undefined,
    loading: false,
  })

  const homedir = createMemo(() => sync.data.path.home || "~")

  // Fetch directories for browsing - returns a function for the List component
  async function fetchDirectories(query: string): Promise<DirectoryInfo[]> {
    const result = await globalSDK.client.project.browse({
      query: query || undefined,
      limit: 50,
    })
    if (result.error) return []
    return (result.data as DirectoryInfo[]) || []
  }

  function openProject(directory: string) {
    layout.projects.open(directory)
    navigate(`/${base64Encode(directory)}`)
  }

  async function handleCreateSubmit(e: SubmitEvent) {
    e.preventDefault()

    const path = store.path?.trim()
    if (!path) {
      setStore("error", "Project path is required")
      return
    }

    if (!path.startsWith("/") && !path.startsWith("~/")) {
      setStore("error", "Path must be absolute (start with / or ~)")
      return
    }

    setStore("error", undefined)
    setStore("loading", true)

    try {
      const result = await globalSDK.client.project.create({ path })

      if (result.error) {
        const errorMessage = (result.error as { message?: string }).message || "Failed to create project"
        setStore("error", errorMessage)
        setStore("loading", false)
        return
      }

      const { project, created } = result.data!
      dialog.close()
      openProject(project.worktree)

      showToast({
        variant: "success",
        icon: "circle-check",
        title: created ? "Project created" : "Project added",
        description: created
          ? `Created project at ${project.worktree.replace(homedir(), "~")}`
          : `Added ${project.worktree.replace(homedir(), "~")}`,
      })
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : "Failed to create project"
      setStore("error", errorMessage)
      setStore("loading", false)
    }
  }

  async function handleAddExisting(dir?: DirectoryInfo | null) {
    const directory = dir ?? selectedDir()
    if (!directory) return

    setStore("loading", true)
    setStore("error", undefined)

    try {
      // Use create endpoint - it handles existing directories gracefully
      const result = await globalSDK.client.project.create({ path: directory.path })

      if (result.error) {
        const errorMessage = (result.error as { message?: string }).message || "Failed to add project"
        setStore("error", errorMessage)
        setStore("loading", false)
        return
      }

      const { project } = result.data!
      dialog.close()
      openProject(project.worktree)

      showToast({
        variant: "success",
        icon: "circle-check",
        title: "Project added",
        description: `Added ${project.worktree.replace(homedir(), "~")}`,
      })
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : "Failed to add project"
      setStore("error", errorMessage)
      setStore("loading", false)
    }
  }

  async function handleBrowse() {
    const result = await platform.openDirectoryPickerDialog?.({
      title: "Select folder to add as project",
      multiple: false,
    })
    if (result && typeof result === "string") {
      // Directly add the selected directory
      setStore("loading", true)
      try {
        const createResult = await globalSDK.client.project.create({ path: result })
        if (createResult.error) {
          const errorMessage = (createResult.error as { message?: string }).message || "Failed to add project"
          setStore("error", errorMessage)
          setStore("loading", false)
          return
        }
        const { project } = createResult.data!
        dialog.close()
        openProject(project.worktree)
        showToast({
          variant: "success",
          icon: "circle-check",
          title: "Project added",
          description: `Added ${project.worktree.replace(homedir(), "~")}`,
        })
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : "Failed to add project"
        setStore("error", errorMessage)
        setStore("loading", false)
      }
    }
  }

  function handleSelect(dir: DirectoryInfo | undefined) {
    if (!dir) return
    if (dir.isExistingProject) {
      dialog.close()
      openProject(dir.path)
      return
    }
    setSelectedDir(dir)
    // Immediately add the project on selection
    handleAddExisting(dir)
  }

  return (
    <Dialog title="Add Project" size="lg">
      <div class="flex flex-col gap-4 px-5 pb-6 flex-1 min-h-0">
        {/* Tab switcher */}
        <div class="flex gap-1 p-1 bg-surface-base rounded-lg">
          <Button
            variant={activeTab() === "existing" ? "secondary" : "ghost"}
            class="flex-1 justify-center"
            onClick={() => setActiveTab("existing")}
          >
            <Icon name="folder-add-left" />
            Add Existing
          </Button>
          <Button
            variant={activeTab() === "create" ? "secondary" : "ghost"}
            class="flex-1 justify-center"
            onClick={() => setActiveTab("create")}
          >
            <Icon name="plus" />
            Create New
          </Button>
        </div>

        {/* Add Existing tab content */}
        <Show when={activeTab() === "existing"}>
          <div class="flex flex-col gap-4 flex-1 min-h-0">
            <div class="text-14-regular text-text-base">
              Search for an existing folder to add as a project, or browse your filesystem.
            </div>

            {/* Directory list with search */}
            <List<DirectoryInfo>
              class="flex-1 min-h-0 [&_[data-slot=list-item]]:h-auto [&_[data-slot=list-item]]:py-2"
              items={fetchDirectories}
              key={(dir) => dir.path}
              filterKeys={["name", "path"]}
              current={selectedDir() ?? undefined}
              onSelect={handleSelect}
              search={{ placeholder: "Search folders...", autofocus: true }}
              emptyMessage="No folders found"
            >
              {(dir) => (
                <div class="flex items-center gap-3 w-full">
                  <span class="text-text-weak shrink-0">
                    <Icon name={dir.isGitRepo ? "github" : "folder"} />
                  </span>
                  <div class="flex-1 min-w-0 flex flex-col">
                    <div class="text-14-medium text-text-strong truncate">{dir.name}</div>
                    <div class="text-12-regular text-text-weak truncate">{dir.path.replace(homedir(), "~")}</div>
                  </div>
                  <Show when={dir.isGitRepo && !dir.isExistingProject}>
                    <span class="shrink-0 text-12-regular text-text-weak bg-surface-base px-2 py-0.5 rounded">git</span>
                  </Show>
                  <Show when={dir.isExistingProject}>
                    <span class="shrink-0 text-12-regular text-text-weak bg-surface-base px-2 py-0.5 rounded">
                      open
                    </span>
                  </Show>
                </div>
              )}
            </List>

            {/* Browse button */}
            <Show when={platform.openDirectoryPickerDialog}>
              <Button variant="ghost" onClick={handleBrowse} class="justify-start">
                <Icon name="folder" />
                Browse filesystem...
              </Button>
            </Show>

            <Show when={store.error}>
              <div class="text-14-regular text-red-500">{store.error}</div>
            </Show>

            <Show when={store.loading}>
              <div class="flex items-center justify-center py-2">
                <Spinner class="size-5" />
              </div>
            </Show>
          </div>
        </Show>

        {/* Create New tab content */}
        <Show when={activeTab() === "create"}>
          <form onSubmit={handleCreateSubmit} class="flex flex-col gap-4">
            <div class="text-14-regular text-text-base">
              Enter the full path where you want to create your new project. A new directory will be created and
              initialized as a git repository.
            </div>
            <TextField
              autofocus={activeTab() === "create"}
              type="text"
              label="Project path"
              placeholder="~/projects/my-new-app"
              name="path"
              value={store.path}
              onChange={(value) => setStore("path", value)}
              validationState={store.error && activeTab() === "create" ? "invalid" : undefined}
              error={activeTab() === "create" ? store.error : undefined}
            />
            <div class="flex gap-3 justify-end pt-2">
              <Button variant="ghost" onClick={() => dialog.close()} disabled={store.loading}>
                Cancel
              </Button>
              <Button type="submit" disabled={store.loading}>
                {store.loading ? (
                  <span class="flex items-center gap-2">
                    <Spinner class="size-4" />
                    Creating...
                  </span>
                ) : (
                  "Create Project"
                )}
              </Button>
            </div>
          </form>
        </Show>
      </div>
    </Dialog>
  )
}
