import { createMemo } from "solid-js"
import { useTuiPaths } from "../../context/runtime"
import { useTheme } from "../../context/theme"
import { Locale } from "../../util/locale"
import { abbreviateHome } from "../../util/path-format"
import { SessionQuestion } from "./permission"
import { usePromptMove } from "../../component/prompt/move"
import { useLocation } from "../../context/location"

export function SessionLocationMissing(props: {
  directory: string
  workspaceID?: string
  projectID: string
  sessionID: string
}) {
  const move = usePromptMove({ projectID: () => props.projectID, sessionID: () => props.sessionID })
  const location = useLocation()
  return (
    <SessionLocationUnavailable
      directory={props.directory}
      onRetry={() => location.set({ directory: props.directory, workspaceID: props.workspaceID })}
      onMove={move.open}
    />
  )
}

export function SessionLocationUnavailable(props: { directory: string; onRetry: () => void; onMove: () => void }) {
  const paths = useTuiPaths()
  const theme = useTheme("elevated")
  const directory = createMemo(() => Locale.truncateMiddle(abbreviateHome(props.directory, paths.home), 72))

  return (
    <SessionQuestion
      id="session.location-missing"
      group="Session recovery"
      choicesLabel="Recovery actions"
      instance={props.directory}
      title="Session location unavailable"
      body={
        <box paddingLeft={1} gap={1}>
          <text fg={theme.text.subdued}>{directory()}</text>
          <text fg={theme.text.default}>Try this directory again or choose another directory.</text>
        </box>
      }
      options={{ retry: "Try again", move: "Choose directory" }}
      onSelect={(option) => (option === "retry" ? props.onRetry() : props.onMove())}
    />
  )
}
