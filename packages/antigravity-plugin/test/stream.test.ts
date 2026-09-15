import { expect, test } from "bun:test"
import { GoogleAntigravityWire } from "../src/wire"

test("SSE unwrap handles split UTF-8, CRLF and final unterminated line", async () => {
  const source = new TextEncoder().encode('data: {"response":{"text":"hé🙂"}}\r\n\r\ndata: [DONE]')
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of source) controller.enqueue(new Uint8Array([byte]))
      controller.close()
    },
  })
  expect(await new Response(stream.pipeThrough(GoogleAntigravityWire.unwrapSSE())).text()).toBe(
    'data: {"text":"hé🙂"}\n\ndata: [DONE]',
  )
})

test("SSE preserves non-envelope errors and malformed data", async () => {
  const text = 'event: error\ndata: {"error":{"message":"denied"}}\n\ndata: invalid\n'
  expect(await new Response(new Response(text).body!.pipeThrough(GoogleAntigravityWire.unwrapSSE())).text()).toBe(text)
})

test("stream cancellation reaches the upstream and stream errors propagate", async () => {
  const reason = new Error("cancelled")
  let cancelled: unknown
  const stream = new ReadableStream<Uint8Array>({
    cancel(value) {
      cancelled = value
    },
  })
  const reader = stream.pipeThrough(GoogleAntigravityWire.unwrapSSE()).getReader()
  await reader.cancel(reason)
  await Bun.sleep(0)
  expect(cancelled).toBe(reason)
  const failed = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(reason)
    },
  })
  await expect(new Response(failed.pipeThrough(GoogleAntigravityWire.unwrapSSE())).text()).rejects.toThrow("cancelled")
})
