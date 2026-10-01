import type { Browser } from "@opencode/plugin-browser/rpc"

export type BrowserPaneEndpoint = Readonly<{ url: string; username?: string; password?: string }>
export type BrowserPaneTarget = Readonly<{
  serverKey: string
  sessionID: string
  endpoint: BrowserPaneEndpoint
  restore?: Browser.State
}>
export type BrowserPaneLayout = {
  tabID: Browser.TabID
  visible: boolean
  bounds?: { x: number; y: number; width: number; height: number }
  background?: readonly [number, number, number, number]
  radius?: number
}

export type BrowserPaneCommand = Browser.Action
export type BrowserPaneState = Browser.State | null
/** An element the user picked in the page. The ref stays valid for browser tools until the page navigates. */
export type BrowserPaneElement = {
  ref: Browser.Ref
  selector: string
  label: string
  role?: string
  name?: string
  text?: string
  /** Border box in the native view's DIPs. */
  rect: { x: number; y: number; width: number; height: number }
}
export type BrowserPaneEvent =
  | { type: "focus"; tabID: Browser.TabID }
  | { type: "preview"; path: string }
  | { type: "state"; state: BrowserPaneState; error?: string }
  | { type: "inspect"; tabID: Browser.TabID; active: boolean; element?: BrowserPaneElement }

export type BrowserPaneRegistration = {
  setLayout(layout?: BrowserPaneLayout): void
  command(command: BrowserPaneCommand): Promise<void>
  /** Captures the shown page, or resolves null when nothing is on screen. */
  capture(tabID: Browser.TabID): Promise<Blob | null>
  /** Starts or stops the page's element picker; the page reports picks and exits as inspect events. */
  inspect(tabID: Browser.TabID, enabled: boolean): void
  /** Highlights a picked element briefly, or clears any highlight when ref is omitted. */
  highlight(tabID: Browser.TabID, ref?: Browser.Ref): void
  close(): void
}

export type BrowserPanePlatform = {
  register(target: BrowserPaneTarget, listener: (event: BrowserPaneEvent) => void): BrowserPaneRegistration
}
