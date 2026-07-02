export type ExitGuard = { last: number }

type Toast = (input: { variant: "warning"; message: string; duration: number }) => void

export function guardedExit(guard: ExitGuard, exit: () => void, toast: Toast) {
  const now = Date.now()
  if (now - guard.last < 2000) {
    exit()
    return
  }
  guard.last = now
  toast({ variant: "warning", message: "Press again to exit", duration: 2000 })
}

export const shared = { last: 0 }