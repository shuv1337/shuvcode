import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SupervisorStore } from "../src/supervisor/store"
import { SupervisorVoice } from "../src/supervisor/voice"

const homes: string[] = []
const stores: ReturnType<typeof SupervisorStore.open>[] = []

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "supervisor-voice-"))
  homes.push(home)
  const store = SupervisorStore.open(home)
  stores.push(store)
  return { home, store, voice: SupervisorVoice.open({ home, store }) }
}

afterEach(() => {
  stores.splice(0).forEach((store) => store.close())
  homes.splice(0).forEach((home) => rmSync(home, { recursive: true, force: true }))
})

test("voice snapshot defaults to counts and full scope excludes denied and private records", async () => {
  const { home, store, voice } = fixture()
  for (const input of [
    { id: "public-work", projectID: "public-project", brief: "PRIVATE_BRIEF" },
    { id: "secret-work", projectID: "secret-project", brief: "SECRET_PROJECT" },
    { id: "old-work", projectID: "public-project", brief: "OLD_DONE_HISTORY" },
  ])
    store.backlog.enqueue({
      ...input,
      kind: "scout",
      deliveryMode: "local-only",
      mergePolicy: "manual",
    })
  store.backlog.markStarted({ id: "old-work", taskID: "old-task" })
  store.backlog.finish("old-work")
  store.channels.inbox.note({ id: "private-note", source: "operator", text: "PRIVATE_INBOX" })
  store.channels.knowledge.put({
    id: "private-guide",
    scope: "preferences",
    title: "Private guide",
    content: "PRIVATE_KNOWLEDGE",
  })
  await expect(voice.request({ sessionID: "worker" }, { type: "voice.snapshot" })).rejects.toThrow(/operator/)
  const counts = await voice.request({ operator: true }, { type: "voice.snapshot" })
  expect(counts).toEqual({
    schema_version: 1,
    read_scope: "counts",
    counts: {
      in_flight: 0,
      queued: 2,
      waiting_for_user: 0,
      open_reviews: 0,
      workers: { active: 0, cancelling: 0, cancelled: 0, completed: 0 },
    },
  })
  expect(JSON.stringify(counts)).not.toMatch(/public-work|secret-work|OLD_DONE_HISTORY|PRIVATE_/)

  await SupervisorVoice.configure(home, { scope: "full", deny: ["secret"] })
  const full = await voice.request({ operator: true }, { type: "voice.snapshot" })
  expect(full).toMatchObject({
    read_scope: "full",
    open: [{ id: "public-work", project: "public-project", state: "queued" }],
    withheld_count: 1,
  })
  expect(JSON.stringify(full)).not.toMatch(/secret-work|secret-project|OLD_DONE_HISTORY|PRIVATE_/)
})

test("voice enqueue is first-wins by interaction ID across restart", async () => {
  const first = fixture()
  await expect(
    first.voice.request(
      { sessionID: "worker" },
      { type: "voice.enqueue", interactionID: "spoken-turn-1", request: "Do the task" },
    ),
  ).rejects.toThrow(/operator/)
  const accepted = await first.voice.request(
    { operator: true },
    { type: "voice.enqueue", interactionID: "spoken-turn-1", request: "Do the task" },
  )
  expect(accepted).toMatchObject({
    queued: true,
    queued_text: "Do the task",
    handover: "The request is queued for the supervisor. It has not started or completed yet.",
  })
  const id = accepted.note_id
  expect(first.store.channels.inbox.list()).toMatchObject([{ id, text: "Do the task", source: "voice" }])
  first.store.close()
  stores.pop()
  const reopened = SupervisorStore.open(first.home)
  stores.push(reopened)
  const recovered = SupervisorVoice.open({ home: first.home, store: reopened })
  expect(
    await recovered.request(
      { operator: true },
      { type: "voice.enqueue", interactionID: "spoken-turn-1", request: "Different request" },
    ),
  ).toMatchObject({ note_id: id, queued_text: "Do the task" })
  expect(reopened.channels.inbox.list()).toMatchObject([{ id, text: "Do the task", source: "voice" }])
  expect(reopened.channels.inbox.list()).toHaveLength(1)
})
