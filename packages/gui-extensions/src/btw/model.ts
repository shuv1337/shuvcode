import { batch, createRoot, getOwner, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { showToast } from "@opencode/ui/toast"
import { createKeyed, type MountedSession, type SetupContext } from "../sdk"
import type Btw from "./index"

const instructions = [
  "The user is asking a quick side question about the conversation so far.",
  "Answer directly and concisely in markdown from what you already know.",
  "Do not call any tools and do not take any actions.",
].join(" ")

/** One-shot side questions per session, one tab each, stored until the tab closes. */
export function createBtw(ctx: SetupContext<typeof Btw>) {
  const owner = getOwner()
  const controllers = new Map<string, AbortController>()
  const [requests, setRequests] = createStore<{ pending: string[] }>({ pending: [] })
  const saved = (session: MountedSession) => ctx.stores.chats(session)

  const stop = (id: string) => {
    controllers.get(id)?.abort()
    controllers.delete(id)
    setRequests("pending", (list) => list.filter((item) => item !== id))
  }

  // In-flight questions keep running when the user leaves their session and answer into its store; only a reload,
  // closing the question's tab or disposing the extension abandons one, which leaves it retryable.
  onCleanup(() => Array.from(controllers.keys()).forEach(stop))

  const entry = (session: MountedSession, id: string) => saved(session).value?.chats.find((item) => item.id === id)
  const pending = (id: string) => requests.pending.includes(id)

  const generate = (session: MountedSession, id: string) => {
    const item = entry(session, id)

    if (!item || pending(id)) return

    const store = saved(session)
    const controller = new AbortController()
    controllers.set(id, controller)
    setRequests("pending", (list) => [...list, id])

    return (
      session.server.client.session
        .generate(
          { sessionID: session.id, prompt: [instructions, item.question].join("\n\n") },
          { signal: controller.signal },
        )
        .then((result) => {
          if (ctx.signal.aborted || controller.signal.aborted) return
          store.update((draft) => {
            const chat = draft.chats.find((item) => item.id === id)

            if (chat) chat.answer = result.text.trim()
          })
        })
        // A missing answer is the retry state; no transient error flag is stored.
        .catch(() => undefined)
        .finally(() => {
          if (controllers.get(id) === controller) stop(id)
        })
    )
  }

  const ask = (value?: string) => {
    const question = value?.trim()

    if (!question) {
      showToast({ title: ctx.t("question.required") })

      return
    }

    const session = ctx.sessions.current()

    if (!session?.id) return

    const store = saved(session)
    const id = crypto.randomUUID()

    // Desktop storage loads asynchronously. Record the question and open its tab once the store has loaded, in one
    // batch, because the host drops a transient tab its panel does not list. Leaving the session first cancels it.
    return new Promise<void>((resolve) => {
      const controller = new AbortController()
      const signal = AbortSignal.any([controller.signal, ctx.signal])

      createRoot((dispose) => {
        const done = () => {
          signal.removeEventListener("abort", done)
          dispose()
          resolve()
        }

        signal.addEventListener("abort", done, { once: true })
        createKeyed(
          () => ctx.sessions.current()?.key === session.key,
          () => onCleanup(() => controller.abort()),
        )
        createKeyed(
          () => store.ready(),
          () => {
            if (signal.aborted) return
            batch(() => {
              store.update((draft) => {
                draft.chats.push({ id, question })
              })
              ctx.layout.open(`${ctx.id}:${id}`, session, { tab: "select" })
            })
            // Release the composer once the request starts, not when its answer arrives.
            void generate(session, id)
            done()
          },
        )
      }, owner)
    })
  }

  return {
    ask,
    saved,
    pending,
    question: (session: MountedSession, id: string) => entry(session, id)?.question,
    answer: (session: MountedSession, id: string) => entry(session, id)?.answer,
    error: (session: MountedSession, id: string) => {
      const item = entry(session, id)

      return !!item && item.answer === undefined && !pending(id)
    },
    retry: generate,
    /** Closing a tab forgets its question and answer. */
    remove: (session: MountedSession, id: string) => {
      stop(id)
      saved(session).update((draft) => {
        draft.chats = draft.chats.filter((item) => item.id !== id)
      })
    },
  }
}

export type BtwModel = ReturnType<typeof createBtw>
