import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import { renderUnicodeCompact } from "uqr"
import { useClient } from "../context/client"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { errorMessage } from "../util/error"

export function DialogPair() {
  const client = useClient()
  const dialog = useDialog()
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const [actionError, setActionError] = createSignal<unknown>()
  const [revoking, setRevoking] = createSignal<string>()
  const [now, setNow] = createSignal(Date.now())

  dialog.setSize("large")
  dialog.setCentered(true)

  const [invitation, invitationActions] = createResource(() => client.api.pairing.invitation.create())
  const [devices, deviceActions] = createResource(() => client.api.pairing.device.list())
  const clock = setInterval(() => setNow(Date.now()), 1_000)
  onCleanup(() => clearInterval(clock))
  const status = createMemo(() => invitationStatus(invitation(), invitation.error, invitation.loading, now()))
  const info = createMemo(() => (status().type === "active" ? invitation() : undefined))
  const horizontal = createMemo(() => dimensions().width >= 96)
  const content = () => {
    const value = info()
    if (!value) return
    return (
      <box flexDirection={horizontal() ? "row" : "column"} alignItems={horizontal() ? "flex-start" : "center"} gap={2}>
        <box width={horizontal() ? 29 : "100%"} flexShrink={0} gap={1}>
          <box>
            <text fg={theme.textMuted}>URLs</text>
            <For each={value.urls}>{(url) => <text fg={theme.text}>{url}</text>}</For>
          </box>
          <box>
            <text fg={theme.textMuted}>Expires</text>
            <text fg={theme.text}>{value.expiresAt}</text>
          </box>
          <text fg={theme.primary} onMouseUp={() => invitationActions.refetch()}>
            Regenerate invitation
          </text>
          <Show when={value.urls.some((url) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname))}>
            <text fg={theme.textMuted} wrapMode="word">
              Configure `shuvcode service set advertised-urls https://host` for Tailscale Serve or a reverse proxy.
            </text>
          </Show>
        </box>
        <box
          width={horizontal() ? undefined : "100%"}
          flexGrow={horizontal() ? 1 : 0}
          flexShrink={0}
          alignItems={horizontal() ? "flex-end" : "center"}
        >
          <text fg={theme.text}>{renderUnicodeCompact(JSON.stringify(value), { border: 1 })}</text>
        </box>
        <box width={horizontal() ? 34 : "100%"} flexShrink={0} gap={1}>
          <text fg={theme.textMuted}>Paired devices</text>
          <Show when={(devices()?.length ?? 0) > 0} fallback={<text fg={theme.textMuted}>No paired devices</text>}>
            <For each={devices()}>
              {(device) => (
                <box flexDirection="row" justifyContent="space-between">
                  <box>
                    <text fg={theme.text}>{device.name}</text>
                    <text fg={theme.textMuted}>{device.revokedAt ? "revoked" : device.deviceID}</text>
                  </box>
                  <Show when={!device.revokedAt}>
                    <text
                      fg={theme.error}
                      onMouseUp={() => {
                        setRevoking(device.deviceID)
                        client.api.pairing.device
                          .revoke({ deviceID: device.deviceID })
                          .then(() => deviceActions.refetch())
                          .catch(setActionError)
                          .finally(() => setRevoking(undefined))
                      }}
                    >
                      {revoking() === device.deviceID ? "Revoking..." : "Revoke"}
                    </text>
                  </Show>
                </box>
              )}
            </For>
          </Show>
        </box>
      </box>
    )
  }

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Pair
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Show when={actionError()}>{(error) => <text fg={theme.error}>{errorMessage(error())}</text>}</Show>
      <Show when={status().type === "loading"}>
        <text fg={theme.textMuted}>Loading pairing invitation...</text>
      </Show>
      <Show when={status().type === "unavailable"}>
        <text fg={theme.error}>Pairing is unavailable: {errorMessage(invitation.error)}</text>
      </Show>
      <Show when={status().type === "expired"}>
        <text fg={theme.textMuted}>This pairing invitation expired. Regenerate it to display a new QR code.</text>
        <text fg={theme.primary} onMouseUp={() => invitationActions.refetch()}>
          Regenerate invitation
        </text>
      </Show>
      <Show when={status().type === "active"}>
        <Show
          when={dimensions().height >= 36}
          fallback={
            <scrollbox
              height={Math.max(8, dimensions().height - Math.floor(dimensions().height / 4) - 6)}
              scrollbarOptions={{ visible: false }}
            >
              {content()}
            </scrollbox>
          }
        >
          {content()}
        </Show>
      </Show>
    </box>
  )
}

export function invitationStatus(
  invitation: { readonly expiresAt: string } | undefined,
  error: unknown,
  loading: boolean,
  now: number,
) {
  if (error) return { type: "unavailable" as const }
  if (!invitation) return { type: loading ? ("loading" as const) : ("unavailable" as const) }
  if (Date.parse(invitation.expiresAt) <= now) return { type: "expired" as const }
  return { type: "active" as const }
}
