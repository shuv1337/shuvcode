import { Browser } from "@opencode/plugin-browser/rpc"
import { Schema } from "effect"
import { Rpc } from "effect/unstable/rpc"
import { Transferable } from "effect/unstable/workers"

const text = (maximum: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(maximum))
const bindingID = text(128)
const endpoint = Schema.Struct({
  url: text(16_384),
  username: Schema.optionalKey(text(1_024)),
  password: Schema.optionalKey(text(4_096)),
})
const target = Schema.Struct({
  serverKey: text(16_384),
  sessionID: text(256).check(Schema.isStartsWith("ses")),
  endpoint,
  restore: Schema.optionalKey(Browser.State),
})
const bounds = Schema.Struct({ x: Schema.Finite, y: Schema.Finite, width: Schema.Finite, height: Schema.Finite })
const channel = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }))
const layout = Schema.Struct({
  tabID: Browser.TabID,
  visible: Schema.Boolean,
  bounds: Schema.optionalKey(bounds),
  background: Schema.optionalKey(Schema.Tuple([channel, channel, channel, channel])),
  radius: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 }))),
})
export const BrowserPaneRequestSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("register"), bindingID, target }),
  Schema.Struct({ type: Schema.Literal("layout"), bindingID, layout: Schema.optionalKey(layout) }),
  Schema.Struct({ type: Schema.Literal("command"), bindingID, command: Browser.Action }),
  Schema.Struct({ type: Schema.Literal("inspect"), bindingID, tabID: Browser.TabID, enabled: Schema.Boolean }),
  Schema.Struct({
    type: Schema.Literal("highlight"),
    bindingID,
    tabID: Browser.TabID,
    ref: Schema.optionalKey(Browser.Ref),
  }),
  Schema.Struct({ type: Schema.Literal("close"), bindingID }),
])
export type BrowserPaneRequest = Schema.Schema.Type<typeof BrowserPaneRequestSchema>

const detail = (maximum: number) => Schema.String.check(Schema.isMaxLength(maximum))
export const BrowserPaneElementSchema = Schema.Struct({
  ref: Browser.Ref,
  selector: detail(2_048),
  label: detail(512),
  role: Schema.optionalKey(detail(128)),
  name: Schema.optionalKey(detail(512)),
  text: Schema.optionalKey(detail(512)),
  rect: bounds,
})
export const BrowserPaneEventSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("focus"), tabID: Browser.TabID }),
  Schema.Struct({ type: Schema.Literal("preview"), path: text(2_048) }),
  Schema.Struct({
    type: Schema.Literal("state"),
    state: Schema.NullOr(Browser.State),
    error: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("inspect"),
    tabID: Browser.TabID,
    active: Schema.Boolean,
    element: Schema.optionalKey(BrowserPaneElementSchema),
  }),
])
export const BrowserPaneRpc = Rpc.make("BrowserPane", { payload: { request: BrowserPaneRequestSchema } })
export const BrowserPaneCaptureRpc = Rpc.make("BrowserPaneCapture", {
  payload: { bindingID, tabID: Browser.TabID },
  success: Schema.NullOr(Transferable.Uint8Array),
})
