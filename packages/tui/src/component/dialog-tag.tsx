import { createMemo, createResource } from "solid-js"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { createStore } from "solid-js/store"

export function DialogTag(props: { onSelect?: (value: string) => void }) {
  const client = useClient()
  const dialog = useDialog()
  const data = useData()

  const [store] = createStore({
    filter: "",
  })

  const [files] = createResource(
    () => [store.filter],
    async () => {
      const result = await client.api.file
        .find({
          query: store.filter,
          type: "file",
          limit: 5,
          location: {
            directory: data.location.default().directory,
            workspace: data.location.default().workspaceID,
          },
        })
        .catch(() => undefined)
      return result?.data.map((item) => item.path) ?? []
    },
  )

  const options = createMemo(() =>
    (files() ?? []).map((file) => ({
      value: file,
      title: file,
    })),
  )

  return (
    <DialogSelect
      title="Autocomplete"
      options={options()}
      onSelect={(option) => {
        props.onSelect?.(option.value)
        dialog.clear()
      }}
    />
  )
}
