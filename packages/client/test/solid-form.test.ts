import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode, type FormInfo, type OpenCodeEvent } from "../src/promise"

const form: FormInfo = {
  id: "form_parent",
  sessionID: "ses_parent",
  title: "Parent question",
  fields: [{ type: "string", key: "answer", title: "Answer", required: true }],
}

test.each(["created", "cancelled", "replied"] as const)(
  "a delayed session form snapshot preserves a newer form.%s event",
  async (action) => {
    const response = Promise.withResolvers<Response>()
    const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
    const api = OpenCode.make({ baseUrl: "http://opencode.local", fetch: () => response.promise })
    const setup = createRoot((dispose) => ({
      dispose,
      data: createData({
        api: () => api,
        directory: "/project",
        event: {
          on: () => () => {},
          listen(handler) {
            listeners.add(handler)
            return () => listeners.delete(handler)
          },
        },
      }),
    }))
    try {
      const reading = setup.data.session.form.sync(form.sessionID)
      const event: OpenCodeEvent =
        action === "created"
          ? { id: "evt_form", created: 1, type: "form.created", location: { directory: "/project" }, data: { form } }
          : { id: "evt_settled", created: 2, type: `form.${action}`, data: { sessionID: form.sessionID, id: form.id } }
      listeners.forEach((listener) => listener({ name: event.type, details: event }))
      response.resolve(Response.json({ data: action === "created" ? [] : [form] }))
      await reading
      expect(setup.data.session.form.list(form.sessionID)).toEqual(action === "created" ? [form] : [])
    } finally {
      response.resolve(Response.json({ data: [] }))
      setup.dispose()
    }
  },
)
