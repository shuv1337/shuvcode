import { createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { pipe, flatMap, entries, filter, sortBy, take } from "remeda"
import { DialogSelect, type DialogSelectRef } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { createDialogProviderOptions, DialogProvider } from "./dialog-provider"
import { Keybind } from "@/util/keybind"

type ModelRef = { providerID: string; modelID: string }

export function DialogModel() {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const [ref, setRef] = createSignal<DialogSelectRef<unknown>>()

  const connected = createMemo(() =>
    sync.data.provider.some((x) => x.id !== "opencode" || Object.values(x.models).some((y) => y.cost?.input !== 0)),
  )

  const providers = createDialogProviderOptions()

  const options = createMemo(() => {
    const query = ref()?.filter
    const favorites = local.model.favorite()
    const recents = local.model.recent()
    const current = local.model.current()

    const isMatch = (a: ModelRef, b: ModelRef) => a.providerID === b.providerID && a.modelID === b.modelID
    const isFavorite = (m: ModelRef) => favorites.some((f) => isMatch(f, m))
    const isRecent = (m: ModelRef) => recents.some((r) => isMatch(r, m))
    const isCurrent = (m: ModelRef) => current && isMatch(current, m)

    const selectModel = (m: ModelRef) => {
      dialog.clear()
      local.model.set(m, { recent: true })
    }

    const toOption = (m: ModelRef, category: string, star?: boolean) => {
      const provider = sync.data.provider.find((x) => x.id === m.providerID)
      if (!provider) return
      const model = provider.models[m.modelID]
      if (!model) return
      return {
        key: m,
        value: m,
        title: model.name ?? m.modelID,
        description: `${provider.name}${star ? " ★" : ""}`,
        category,
        disabled: provider.id === "opencode" && model.id.includes("-nano"),
        footer: model.cost?.input === 0 && provider.id === "opencode" ? "Free" : undefined,
        onSelect: () => selectModel(m),
      }
    }

    // Sort with current first
    const sortCurrent = <T extends ModelRef>(list: T[]) =>
      current ? [...list.filter((x) => isCurrent(x)), ...list.filter((x) => !isCurrent(x))] : list

    const favoriteOptions =
      !query && favorites.length > 0 ? sortCurrent(favorites).flatMap((m) => toOption(m, "Favorites", true) ?? []) : []

    const recentList = recents.filter((m) => !isFavorite(m)).slice(0, 5)
    const recentOptions = !query ? sortCurrent(recentList).flatMap((m) => toOption(m, "Recent") ?? []) : []

    const allModels = pipe(
      sync.data.provider,
      sortBy(
        (p) => p.id !== "opencode",
        (p) => p.name,
      ),
      flatMap((provider) =>
        pipe(
          provider.models,
          entries(),
          filter(([, info]) => !query || !!(info.name ?? "").toLowerCase().includes(query.toLowerCase())),
          sortBy(([, info]) => info.name ?? ""),
          flatMap(([modelID, info]) => {
            const m = { providerID: provider.id, modelID }
            if (!query && (isFavorite(m) || isRecent(m))) return []
            return [
              {
                value: m,
                title: info.name ?? modelID,
                description: connected() ? `${provider.name}${isFavorite(m) ? " ★" : ""}` : undefined,
                category: connected() ? provider.name : undefined,
                disabled: provider.id === "opencode" && modelID.includes("-nano"),
                footer: info.cost?.input === 0 && provider.id === "opencode" ? "Free" : undefined,
                onSelect: () => selectModel(m),
              },
            ]
          }),
        ),
      ),
    )

    const providerOptions = !connected()
      ? pipe(
          providers(),
          take(6),
          flatMap((opt) => [{ ...opt, category: "Popular providers" }]),
        )
      : []

    return [...favoriteOptions, ...recentOptions, ...allModels, ...providerOptions]
  })

  return (
    <DialogSelect
      keybind={[
        {
          keybind: { ctrl: true, name: "a", meta: false, shift: false, leader: false },
          title: connected() ? "Connect provider" : "More providers",
          onTrigger() {
            dialog.replace(() => <DialogProvider />)
          },
        },
        {
          keybind: Keybind.parse("ctrl+f")[0],
          title: "Favorite",
          onTrigger: (option) => {
            local.model.toggleFavorite(option.value as ModelRef)
          },
        },
      ]}
      ref={setRef}
      title="Select model"
      current={local.model.current()}
      options={options()}
    />
  )
}
