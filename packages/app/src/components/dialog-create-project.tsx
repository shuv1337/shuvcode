import { Component, createSignal, createMemo, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLayout } from "@/context/layout"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { Switch } from "@opencode-ai/ui/switch"
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

// Helper to validate project name (no path separators, no traversal)
function validateProjectName(name: string): string | undefined {
  if (!name.trim()) return "Project name is required"
  if (name.includes("/") || name.includes("\\")) return "Project name cannot contain path separators"
  if (name === "." || name === "..") return "Invalid project name"
  if (name.includes("..")) return "Project name cannot contain path traversal"
  return undefined
}

// Helper to derive folder name from repo URL
function deriveFolderNameFromRepo(repoUrl: string): string {
  if (!repoUrl.trim()) return ""
  // Remove trailing slashes, .git suffix, and get the last path segment
  const cleaned = repoUrl.trim().replace(/\/+$/, "").replace(/\.git$/, "")
  const parts = cleaned.split("/")
  const lastPart = parts[parts.length - 1] || ""
  // Remove any remaining path separators from the derived name
  return lastPart.replace(/[/\\]/g, "")
}

// Helper to compute resolved path
function computeResolvedPath(parentDir: string, projectName: string): string {
  if (!parentDir || !projectName.trim()) return ""
  // Normalize parent dir (remove trailing slash)
  const normalizedParent = parentDir.replace(/\/+$/, "")
  return `${normalizedParent}/${projectName.trim()}`
}

export const DialogCreateProject: Component = () => {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const layout = useLayout()
  const navigate = useNavigate()
  const platform = usePlatform()
  const sync = useGlobalSync()

  const [activeTab, setActiveTab] = createSignal<"existing" | "create" | "clone">("existing")
  const [selectedDir, setSelectedDir] = createSignal<DirectoryInfo | null>(null)

  const [store, setStore] = createStore({
    // Common
    error: undefined as string | undefined,
    loading: false,
    // Create New flow
    createParentDir: "",
    createProjectName: "",
    // Clone flow
    cloneRepoUrl: "",
    cloneParentDir: "",
    cloneProjectName: "", // Optional, derived from repo if empty
    cloneDegit: false,
  })

  const homedir = createMemo(() => sync.data.path.home || "~")

  // Computed resolved paths
  const createResolvedPath = createMemo(() => computeResolvedPath(store.createParentDir, store.createProjectName))

  const cloneDerivedName = createMemo(() => {
    if (store.cloneProjectName.trim()) return store.cloneProjectName.trim()
    return deriveFolderNameFromRepo(store.cloneRepoUrl)
  })

  const cloneResolvedPath = createMemo(() => computeResolvedPath(store.cloneParentDir, cloneDerivedName()))

  // Validation for Create New
  const createNameError = createMemo(() => validateProjectName(store.createProjectName))
  const createPathError = createMemo(() => {
    const path = createResolvedPath()
    if (!path) return undefined
    if (!path.startsWith("/") && !path.startsWith("~")) return "Path must be absolute"
    return undefined
  })

  // Validation for Clone
  const cloneRepoError = createMemo(() => {
    if (!store.cloneRepoUrl.trim()) return "Repository URL is required"
    return undefined
  })
  const cloneNameError = createMemo(() => {
    const name = cloneDerivedName()
    if (!name) return "Project name is required (enter manually or provide valid repo URL)"
    return validateProjectName(name)
  })
  const clonePathError = createMemo(() => {
    const path = cloneResolvedPath()
    if (!path) return undefined
    if (!path.startsWith("/") && !path.startsWith("~")) return "Path must be absolute"
    return undefined
  })

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

    // Validate
    const nameError = createNameError()
    if (nameError) {
      setStore("error", nameError)
      return
    }
    if (!store.createParentDir) {
      setStore("error", "Parent directory is required")
      return
    }
    const pathError = createPathError()
    if (pathError) {
      setStore("error", pathError)
      return
    }

    const resolvedPath = createResolvedPath()
    if (!resolvedPath) {
      setStore("error", "Could not resolve project path")
      return
    }

    setStore("error", undefined)
    setStore("loading", true)

    try {
      const result = await globalSDK.client.project.create({
        path: resolvedPath,
        name: store.createProjectName.trim(),
      })

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

  async function handleCloneSubmit(e: SubmitEvent) {
    e.preventDefault()

    // Validate
    const repoError = cloneRepoError()
    if (repoError) {
      setStore("error", repoError)
      return
    }
    if (!store.cloneParentDir) {
      setStore("error", "Parent directory is required")
      return
    }
    const nameError = cloneNameError()
    if (nameError) {
      setStore("error", nameError)
      return
    }
    const pathError = clonePathError()
    if (pathError) {
      setStore("error", pathError)
      return
    }

    const resolvedPath = cloneResolvedPath()
    if (!resolvedPath) {
      setStore("error", "Could not resolve project path")
      return
    }

    setStore("error", undefined)
    setStore("loading", true)

    try {
      const result = await globalSDK.client.project.create({
        path: resolvedPath,
        repo: store.cloneRepoUrl.trim(),
        degit: store.cloneDegit,
        name: cloneDerivedName(),
      })

      if (result.error) {
        const errorMessage = (result.error as { message?: string }).message || "Failed to clone repository"
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
        title: created ? "Repository cloned" : "Project added",
        description: created
          ? `Cloned to ${project.worktree.replace(homedir(), "~")}`
          : `Added ${project.worktree.replace(homedir(), "~")}`,
      })
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : "Failed to clone repository"
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

  async function handleBrowseExisting() {
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

  async function handleBrowseCreateParent() {
    const result = await platform.openDirectoryPickerDialog?.({
      title: "Select parent directory for new project",
      multiple: false,
    })
    if (result && typeof result === "string") {
      setStore("createParentDir", result)
    }
  }

  async function handleBrowseCloneParent() {
    const result = await platform.openDirectoryPickerDialog?.({
      title: "Select parent directory for cloned repository",
      multiple: false,
    })
    if (result && typeof result === "string") {
      setStore("cloneParentDir", result)
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
          <Button
            variant={activeTab() === "clone" ? "secondary" : "ghost"}
            class="flex-1 justify-center"
            onClick={() => setActiveTab("clone")}
          >
            <Icon name="github" />
            Git Clone
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
              <Button variant="ghost" onClick={handleBrowseExisting} class="justify-start">
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
              Select a parent directory and enter a name for your new project. A new folder will be created and
              initialized as a git repository.
            </div>

            {/* Parent directory picker */}
            <div class="flex flex-col gap-2">
              <label class="text-14-medium text-text-strong">Parent directory</label>
              <div class="flex gap-2">
                <TextField
                  class="flex-1"
                  type="text"
                  placeholder="~/projects"
                  name="createParentDir"
                  value={store.createParentDir}
                  onChange={(value) => setStore("createParentDir", value)}
                />
                <Show when={platform.openDirectoryPickerDialog}>
                  <Button type="button" variant="secondary" onClick={handleBrowseCreateParent}>
                    <Icon name="folder" />
                    Browse
                  </Button>
                </Show>
              </div>
            </div>

            {/* Project name */}
            <TextField
              autofocus={activeTab() === "create"}
              type="text"
              label="Project name"
              placeholder="my-new-app"
              name="createProjectName"
              value={store.createProjectName}
              onChange={(value) => setStore("createProjectName", value)}
              validationState={createNameError() ? "invalid" : undefined}
              error={createNameError()}
            />

            {/* Resolved path preview */}
            <Show when={createResolvedPath()}>
              <div class="flex flex-col gap-1">
                <label class="text-12-regular text-text-weak">Will create at:</label>
                <div class="text-14-regular text-text-base font-mono bg-surface-base px-3 py-2 rounded">
                  {createResolvedPath().replace(homedir(), "~")}
                </div>
              </div>
            </Show>

            <Show when={store.error && activeTab() === "create"}>
              <div class="text-14-regular text-red-500">{store.error}</div>
            </Show>

            <div class="flex gap-3 justify-end pt-2">
              <Button variant="ghost" onClick={() => dialog.close()} disabled={store.loading}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={store.loading || !store.createParentDir || !store.createProjectName || !!createNameError()}
              >
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

        {/* Git Clone tab content */}
        <Show when={activeTab() === "clone"}>
          <form onSubmit={handleCloneSubmit} class="flex flex-col gap-4">
            <div class="text-14-regular text-text-base">
              Clone a git repository into a new project folder.
            </div>

            {/* Repository URL */}
            <TextField
              autofocus={activeTab() === "clone"}
              type="text"
              label="Repository URL"
              placeholder="https://github.com/user/repo"
              name="cloneRepoUrl"
              value={store.cloneRepoUrl}
              onChange={(value) => setStore("cloneRepoUrl", value)}
            />

            {/* Parent directory picker */}
            <div class="flex flex-col gap-2">
              <label class="text-14-medium text-text-strong">Parent directory</label>
              <div class="flex gap-2">
                <TextField
                  class="flex-1"
                  type="text"
                  placeholder="~/projects"
                  name="cloneParentDir"
                  value={store.cloneParentDir}
                  onChange={(value) => setStore("cloneParentDir", value)}
                />
                <Show when={platform.openDirectoryPickerDialog}>
                  <Button type="button" variant="secondary" onClick={handleBrowseCloneParent}>
                    <Icon name="folder" />
                    Browse
                  </Button>
                </Show>
              </div>
            </div>

            {/* Project name (optional, derived from repo) */}
            <TextField
              type="text"
              label="Project name (optional)"
              placeholder={deriveFolderNameFromRepo(store.cloneRepoUrl) || "Derived from repo URL"}
              name="cloneProjectName"
              value={store.cloneProjectName}
              onChange={(value) => setStore("cloneProjectName", value)}
              validationState={store.cloneProjectName.trim() && cloneNameError() ? "invalid" : undefined}
              error={store.cloneProjectName.trim() ? cloneNameError() : undefined}
            />

            {/* Resolved path preview */}
            <Show when={cloneResolvedPath()}>
              <div class="flex flex-col gap-1">
                <label class="text-12-regular text-text-weak">Will clone to:</label>
                <div class="text-14-regular text-text-base font-mono bg-surface-base px-3 py-2 rounded">
                  {cloneResolvedPath().replace(homedir(), "~")}
                </div>
              </div>
            </Show>

            {/* Degit toggle */}
            <div class="flex items-center gap-2">
              <Switch checked={store.cloneDegit} onChange={(checked) => setStore("cloneDegit", checked)}>
                Degit (remove .git history after cloning)
              </Switch>
            </div>

            <Show when={store.error && activeTab() === "clone"}>
              <div class="text-14-regular text-red-500">{store.error}</div>
            </Show>

            <div class="flex gap-3 justify-end pt-2">
              <Button variant="ghost" onClick={() => dialog.close()} disabled={store.loading}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  store.loading ||
                  !store.cloneRepoUrl.trim() ||
                  !store.cloneParentDir ||
                  !cloneDerivedName() ||
                  !!cloneNameError()
                }
              >
                {store.loading ? (
                  <span class="flex items-center gap-2">
                    <Spinner class="size-4" />
                    Cloning...
                  </span>
                ) : (
                  "Clone Repository"
                )}
              </Button>
            </div>
          </form>
        </Show>
      </div>
    </Dialog>
  )
}
