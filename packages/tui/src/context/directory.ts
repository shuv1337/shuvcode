import { createMemo } from "solid-js"
import { useData } from "./data"
import { abbreviateHome } from "../runtime"
import { useTuiPaths } from "./runtime"

export function useDirectory() {
  const data = useData()
  const paths = useTuiPaths()
  return createMemo(() => {
    const directory = data.location.info()?.directory ?? data.location.default().directory ?? paths.cwd
    return abbreviateHome(directory, paths.home)
  })
}
