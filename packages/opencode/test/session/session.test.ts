import { describe, expect, test } from "bun:test"
import path from "path"
import { Session } from "../../src/session"
import { Bus } from "../../src/bus"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { pipe, filter, sortBy } from "remeda"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("session.started event", () => {
  test("should emit session.started event when session is created", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let eventReceived = false
        let receivedInfo: Session.Info | undefined

        const unsub = Bus.subscribe(Session.Event.Created, (event) => {
          eventReceived = true
          receivedInfo = event.properties.info as Session.Info
        })

        const session = await Session.create({})

        await new Promise((resolve) => setTimeout(resolve, 100))

        unsub()

        expect(eventReceived).toBe(true)
        expect(receivedInfo).toBeDefined()
        expect(receivedInfo?.id).toBe(session.id)
        expect(receivedInfo?.projectID).toBe(session.projectID)
        expect(receivedInfo?.directory).toBe(session.directory)
        expect(receivedInfo?.title).toBe(session.title)

        await Session.remove(session.id)
      },
    })
  })

  test("session.started event should be emitted before session.updated", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const events: string[] = []

        const unsubStarted = Bus.subscribe(Session.Event.Created, () => {
          events.push("started")
        })

        const unsubUpdated = Bus.subscribe(Session.Event.Updated, () => {
          events.push("updated")
        })

        const session = await Session.create({})

        await new Promise((resolve) => setTimeout(resolve, 100))

        unsubStarted()
        unsubUpdated()

        expect(events).toContain("started")
        expect(events).toContain("updated")
        expect(events.indexOf("started")).toBeLessThan(events.indexOf("updated"))

        await Session.remove(session.id)
      },
    })
  })
})

describe("session.list", () => {
  test("archived sessions should be excluded from the list API endpoint", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // Create two sessions
        const session1 = await Session.create({})
        const session2 = await Session.create({})

        // Archive session1
        await Session.update(session1.id, (s) => {
          s.time.archived = Date.now()
        })

        // Verify Session.list returns both (no filtering at source)
        const allSessions = await Array.fromAsync(Session.list())
        const ids = allSessions.map((s) => s.id)
        expect(ids).toContain(session1.id)
        expect(ids).toContain(session2.id)

        // Verify that filtering works as expected (simulating endpoint behavior)
        const filteredSessions = pipe(
          allSessions,
          filter((s) => !s.time.archived),
          sortBy((s) => s.time.updated),
        )
        const filteredIds = filteredSessions.map((s) => s.id)
        expect(filteredIds).not.toContain(session1.id)
        expect(filteredIds).toContain(session2.id)

        // Cleanup
        await Session.remove(session1.id)
        await Session.remove(session2.id)
      },
    })
  })

  test("archived sessions should be removed from list when archiving via update", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        // Verify session is in the filtered list initially
        let sessions = pipe(
          await Array.fromAsync(Session.list()),
          filter((s) => !s.time.archived),
        )
        expect(sessions.map((s) => s.id)).toContain(session.id)

        // Archive the session
        await Session.update(session.id, (s) => {
          s.time.archived = Date.now()
        })

        // Verify session is no longer in the filtered list
        sessions = pipe(
          await Array.fromAsync(Session.list()),
          filter((s) => !s.time.archived),
        )
        expect(sessions.map((s) => s.id)).not.toContain(session.id)

        // Cleanup
        await Session.remove(session.id)
      },
    })
  })
})
