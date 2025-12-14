import { UserMessage } from "@opencode-ai/sdk/v2"
import { ComponentProps, createSignal, For, Match, onCleanup, onMount, Show, splitProps, Switch } from "solid-js"
import { DiffChanges } from "./diff-changes"
import { Tooltip } from "@kobalte/core/tooltip"

export function MessageNav(
  props: ComponentProps<"ul"> & {
    messages: UserMessage[]
    current?: UserMessage
    size: "normal" | "compact"
    onMessageSelect: (message: UserMessage) => void
  },
) {
  const [local, others] = splitProps(props, ["messages", "current", "size", "onMessageSelect"])

  const [hover, setHover] = createSignal(false)

  onMount(() => {
    const query = window.matchMedia("(hover: hover) and (pointer: fine)")
    const update = (event: MediaQueryListEvent) => setHover(event.matches)
    setHover(query.matches)
    query.addEventListener("change", update)
    onCleanup(() => query.removeEventListener("change", update))
  })

  const content = () => (
    <ul role="list" data-component="message-nav" data-size={local.size} {...others}>
      <For each={local.messages}>
        {(message, index) => {
          const handleClick = () => local.onMessageSelect(message)
          const ariaLabel = () => message.summary?.title || `Message ${index() + 1}`

          return (
            <li data-slot="message-nav-item">
              <Switch>
                <Match when={local.size === "compact"}>
                  <button
                    type="button"
                    data-slot="message-nav-tick-button"
                    data-active={message.id === local.current?.id || undefined}
                    onClick={handleClick}
                    aria-label={ariaLabel()}
                  >
                    <div data-slot="message-nav-tick-line" />
                  </button>
                </Match>
                <Match when={local.size === "normal"}>
                  <button data-slot="message-nav-message-button" onClick={handleClick}>
                    <DiffChanges changes={message.summary?.diffs ?? []} variant="bars" />
                    <div
                      data-slot="message-nav-title-preview"
                      data-active={message.id === local.current?.id || undefined}
                    >
                      <Show when={message.summary?.title} fallback="New message">
                        {message.summary?.title}
                      </Show>
                    </div>
                  </button>
                </Match>
              </Switch>
            </li>
          )
        }}
      </For>
    </ul>
  )

  return (
    <Switch>
      <Match when={local.size === "compact"}>
        <Show when={hover()} fallback={content()}>
          <Tooltip openDelay={0} closeDelay={300} placement="right-start" gutter={-40} shift={-10} overlap>
            <Tooltip.Trigger as="div">{content()}</Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content data-slot="message-nav-tooltip">
                <div data-slot="message-nav-tooltip-content">
                  <MessageNav {...props} size="normal" class="" />
                </div>
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip>
        </Show>
      </Match>
      <Match when={local.size === "normal"}>{content()}</Match>
    </Switch>
  )
}
