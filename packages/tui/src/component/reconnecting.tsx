import { useTheme } from "../context/theme"
import { Spinner } from "./spinner"

export function Reconnecting() {
  const theme = useTheme().theme

  return (
    <box
      position="absolute"
      zIndex={10_000}
      top={0}
      right={0}
      bottom={0}
      left={0}
      backgroundColor={theme.background}
      alignItems="center"
      justifyContent="center"
    >
      <box width={62} maxWidth="90%" flexDirection="column" alignItems="center" gap={1}>
        <Spinner color={theme.textMuted}>Waiting for background service...</Spinner>
      </box>
    </box>
  )
}
