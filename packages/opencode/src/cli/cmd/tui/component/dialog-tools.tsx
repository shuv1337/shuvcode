import { createMemo, createResource } from "solid-js"
import { map, pipe, sortBy } from "remeda"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useSDK } from "@tui/context/sdk"

type ToolInfo = {
  id: string
  enabled: boolean
}

export function DialogTools() {
  const sdk = useSDK()

  const [tools] = createResource(async () => {
    const response = await fetch(`${sdk.url}/tool/list`)
    if (!response.ok) return []
    return (await response.json()) as ToolInfo[]
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const toolList = tools() ?? []

    return pipe(
      toolList,
      sortBy((t) => t.id),
      map((t) => ({
        value: t.id,
        title: t.id,
        footer: t.enabled ? undefined : "disabled",
        category: undefined,
      })),
    )
  })

  return (
    <DialogSelect
      title="Tools"
      options={options()}
      onSelect={() => {
        // Don't close on select, only on escape
      }}
    />
  )
}
