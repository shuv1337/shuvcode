import { expect, test } from "bun:test"
import { Session } from "@opencode/schema/session"
import { BrowserMachine } from "../src/machine.js"
import { Browser } from "../src/rpc.js"

const sessionID = Session.ID.make("ses_replay")
const tabID = Browser.TabID.make(`tab_${crypto.randomUUID()}`)
const tab = {
  id: tabID,
  url: "https://example.com/",
  title: "Example",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  generation: 1,
}
const snapshot: Browser.Command = { action: { type: "snapshot", tabID }, files: [] }

type Event = BrowserMachine.ConnectionEvent

function run(state: BrowserMachine.ConnectionState, ...events: Event[]) {
  return events.reduce(
    (result, event) => {
      const next = BrowserMachine.transitionConnection(result.state, event)
      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] as BrowserMachine.ConnectionEffect[] },
  )
}

function attach(state: BrowserMachine.ConnectionState, connectionID: string) {
  const started = run(state, {
    type: "attach.started",
    sessionID,
    attempt: BrowserMachine.selectNextAttempt(state),
    connectionID,
  })
  const grant = started.effects.flatMap((effect) => (effect.type === "sync-permissions" ? [effect] : [])).at(-1)
  if (!grant) throw new Error("expected a grant")
  return run(started.state, { type: "permissions.synced", sessionID, attempt: grant.attempt })
}

/** `req_1` was sent to `conn_1`, which `conn_2` replaced and then adopted. */
function adopted() {
  const first = attach(BrowserMachine.createConnectionState(), "conn_1").state
  const sent = run(first, {
    type: "request.started",
    sessionID,
    connectionID: "conn_1",
    requestID: "req_1",
    command: snapshot,
  })
  return attach(sent.state, "conn_2")
}

function settled(effects: readonly BrowserMachine.ConnectionEffect[]) {
  return effects.flatMap((effect) => (effect.type === "settle-request" ? [effect.requestID] : []))
}

test("a stale reconnect timer leaves an adopted tab command waiting for the tab list", () => {
  const next = adopted()
  expect(BrowserMachine.selectWaiting(next.state, sessionID)).toBe(1)
  const stale = BrowserMachine.transitionConnection(next.state, {
    type: "replay.expired",
    sessionID,
    requestID: "req_1",
    phase: "reconnect",
  })
  expect(stale.state).toBe(next.state)
  expect(stale.effects).toEqual([])

  const listed = run(stale.state, {
    type: "state.updated",
    sessionID,
    connectionID: "conn_2",
    browserState: { tabs: [tab], focusedTabID: tabID },
  })
  expect(listed.effects).toEqual([{ type: "replay-request", requestID: "req_1", connectionID: "conn_2", tab }])
  expect(BrowserMachine.selectWaiting(listed.state, sessionID)).toBe(0)
})

test("a tab list without the tab fails the replay as not run", () => {
  const listed = run(adopted().state, {
    type: "state.updated",
    sessionID,
    connectionID: "conn_2",
    browserState: { tabs: [], focusedTabID: null },
  })
  expect(settled(listed.effects)).toEqual(["req_1"])
  expect(BrowserMachine.selectWaiting(listed.state, sessionID)).toBe(0)
})

test("disposal fails parked requests as not run", () => {
  const disposed = run(adopted().state, { type: "disposed" })
  expect(settled(disposed.effects)).toEqual(["req_1"])
  expect(BrowserMachine.selectWaiting(disposed.state, sessionID)).toBe(0)
})
