import { batch, createMemo } from "solid-js"
import { produce, reconcile } from "solid-js/store"
import { Binary } from "@opencode-ai/util/binary"
import { retry } from "@opencode-ai/util/retry"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useGlobalSync } from "./global-sync"
import { useSDK } from "./sdk"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const globalSync = useGlobalSync()
    const sdk = useSDK()
    const [store, setStore] = globalSync.child(sdk.directory)

    const load = {
      project: () => sdk.client.project.current().then((x) => setStore("project", x.data!.id)),
      provider: () =>
        sdk.client.provider.list().then((x) => setStore("provider", x.data ?? { all: [], connected: [], default: {} })),
      path: () => sdk.client.path.get().then((x) => setStore("path", x.data!)),
      agent: () => sdk.client.app.agents().then((x) => setStore("agent", x.data ?? [])),
      session: () =>
        sdk.client.session.list().then((x) => {
          const sessions = (x.data ?? [])
            .slice()
            .filter((s) => !s.time.archived)
            .sort((a, b) => a.id.localeCompare(b.id))
            .slice(0, store.limit)
          setStore("session", sessions)
        }),
      status: () => sdk.client.session.status().then((x) => setStore("session_status", x.data!)),
      config: () => sdk.client.config.get().then((x) => setStore("config", x.data!)),
      changes: () => sdk.client.file.status().then((x) => setStore("changes", x.data!)),
      node: () => sdk.client.file.list({ path: "/" }).then((x) => setStore("node", x.data!)),
      command: () => sdk.client.command.list().then((x) => setStore("command", x.data ?? [])),
    }

    Promise.all(Object.values(load).map((p) => p())).then(() => setStore("status", "complete"))

    const absolute = (path: string) => (store.path.directory + "/" + path).replace("//", "/")

    return {
      data: store,
      set: setStore,
      get status() {
        return store.status
      },
      get ready() {
        return store.status !== "loading"
      },
      get project() {
        const match = Binary.search(globalSync.data.project, store.project, (p) => p.id)
        if (match.found) return globalSync.data.project[match.index]
        return undefined
      },
      session: {
        get(sessionID: string) {
          const match = Binary.search(store.session, sessionID, (s) => s.id)
          if (match.found) return store.session[match.index]
          return undefined
        },
        addOptimisticMessage(input: {
          sessionID: string
          messageID: string
          parts: Part[]
          agent: string
          model: { providerID: string; modelID: string }
        }) {
          const message: Message = {
            id: input.messageID,
            sessionID: input.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: input.agent,
            model: input.model,
          }
          setStore(
            produce((draft) => {
              const messages = draft.message[input.sessionID]
              if (!messages) {
                draft.message[input.sessionID] = [message]
              } else {
                const result = Binary.search(messages, input.messageID, (m) => m.id)
                messages.splice(result.index, 0, message)
              }
              draft.part[input.messageID] = input.parts
                .filter((p) => !!p?.id)
                .slice()
                .sort((a, b) => a.id.localeCompare(b.id))
            }),
          )
        },
        async sync(sessionID: string, _isRetry = false) {
          const [session, messages, todo, diff] = await Promise.all([
            retry(() => sdk.client.session.get({ sessionID })),
            retry(() => sdk.client.session.messages({ sessionID, limit: 1000 })),
            retry(() => sdk.client.session.todo({ sessionID })),
            retry(() => sdk.client.session.diff({ sessionID })),
          ])

          batch(() => {
            setStore(
              "session",
              produce((draft) => {
                const match = Binary.search(draft, sessionID, (s) => s.id)
                if (match.found) {
                  draft[match.index] = session.data!
                  return
                }
                draft.splice(match.index, 0, session.data!)
              }),
            )

            setStore("todo", sessionID, reconcile(todo.data ?? [], { key: "id" }))
            setStore(
              "message",
              sessionID,
              reconcile(
                (messages.data ?? [])
                  .map((x) => x.info)
                  .filter((m) => !!m?.id)
                  .slice()
                  .sort((a, b) => a.id.localeCompare(b.id)),
                { key: "id" },
              ),
            )

            for (const message of messages.data ?? []) {
              if (!message?.info?.id) continue
              setStore(
                "part",
                message.info.id,
                reconcile(
                  message.parts
                    .filter((p) => !!p?.id)
                    .slice()
                    .sort((a, b) => a.id.localeCompare(b.id)),
                  { key: "id" },
                ),
              )
            }

            setStore("session_diff", sessionID, reconcile(diff.data ?? [], { key: "file" }))
          })
        },
        fetch: async (count = 10) => {
          setStore("limit", (x) => x + count)
          await sdk.client.session.list().then((x) => {
            const sessions = (x.data ?? [])
              .filter((s) => !!s?.id)
              .slice()
              .filter((s) => !s.time.archived)
              .sort((a, b) => a.id.localeCompare(b.id))
              .slice(0, store.limit)
            setStore("session", reconcile(sessions, { key: "id" }))
          })
        },
        more: createMemo(() => store.session.length >= store.limit),
        archive: async (sessionID: string) => {
          await sdk.client.session.update({ sessionID, time: { archived: Date.now() } })
          setStore(
            produce((draft) => {
              const match = Binary.search(draft.session, sessionID, (s) => s.id)
              if (match.found) draft.session.splice(match.index, 1)
            }),
          )
        },
      },
      absolute,
      get directory() {
        return store.path.directory
      },
    }
  },
})
