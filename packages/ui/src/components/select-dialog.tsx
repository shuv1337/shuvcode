import { Show, type JSX, splitProps } from "solid-js"
import { Dialog } from "./dialog"
import { List, ListRef, ListProps } from "./list"
import { useDialog } from "../context/dialog"

interface SelectDialogProps<T> extends Omit<ListProps<T>, "filter" | "actions" | "search"> {
  title: string
  placeholder?: string
  actions?: JSX.Element
  itemActions?: (item: T) => JSX.Element
}

export function SelectDialog<T>(props: SelectDialogProps<T>) {
  const [local, others] = splitProps(props, ["title", "placeholder", "actions", "itemActions"])
  const dialog = useDialog()
  let listRef: ListRef | undefined

  const handleSelect = (item: T | undefined, index: number) => {
    others.onSelect?.(item, index)
    dialog.pop()
  }

  return (
    <Dialog title={local.title} action={local.actions}>
      <List
        ref={(ref) => {
          listRef = ref
        }}
        search={{ placeholder: local.placeholder, autofocus: true }}
        items={others.items}
        key={others.key}
        filterKeys={others.filterKeys}
        current={others.current}
        groupBy={others.groupBy}
        sortBy={others.sortBy}
        sortGroupsBy={others.sortGroupsBy}
        emptyMessage={others.emptyMessage}
        activeIcon={others.activeIcon}
        onSelect={handleSelect}
        onKeyEvent={others.onKeyEvent}
      >
        {others.children}
      </List>
    </Dialog>
  )
}
