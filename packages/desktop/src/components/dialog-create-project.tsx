import { Component } from "solid-js"
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

export const DialogCreateProject: Component = () => {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const layout = useLayout()
  const navigate = useNavigate()

  const [store, setStore] = createStore({
    path: "",
    error: undefined as string | undefined,
    loading: false,
  })

  function openProject(directory: string) {
    layout.projects.open(directory)
    navigate(`/${base64Encode(directory)}`)
  }

  async function handleSubmit(e: SubmitEvent) {
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

      const project = result.data!
      dialog.close()
      openProject(project.worktree)

      showToast({
        variant: "success",
        icon: "circle-check",
        title: "Project created",
        description: `Created project at ${project.worktree}`,
      })
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : "Failed to create project"
      setStore("error", errorMessage)
      setStore("loading", false)
    }
  }

  return (
    <Dialog title="Create New Project">
      <form onSubmit={handleSubmit} class="flex flex-col gap-6 px-5 pb-6">
        <div class="text-14-regular text-text-base">
          Enter the full path where you want to create your new project. A new directory will be created and initialized
          as a git repository.
        </div>
        <TextField
          autofocus
          type="text"
          label="Project path"
          placeholder="~/projects/my-new-app"
          name="path"
          value={store.path}
          onChange={(value) => setStore("path", value)}
          validationState={store.error ? "invalid" : undefined}
          error={store.error}
        />
        <div class="flex gap-3 justify-end">
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
    </Dialog>
  )
}
