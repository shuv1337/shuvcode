import { describe, expect, test } from "bun:test"
import { Effect, Redacted } from "effect"
import { HttpClientRequest } from "effect/http"
import { Realtime } from "../src/experimental.js"
import { it } from "./lib/effect.js"
import { dynamicResponse } from "./lib/http.js"

describe("experimental Realtime", () => {
  it.effect("connects OpenAI GPT-Live, OpenAI Realtime (WebRTC + WebSocket), and xAI Grok Voice", () =>
    Effect.gen(function* () {
      expect(
        yield* Realtime.connect({
          model: "gpt-live-1",
          apiKey: Redacted.make("sk-openai"),
          session: { instructions: "Be concise.", voice: "marin" },
          transport: { type: "webrtc", sdp: "v=0\r\no=offer\r\n", dcid: 4 },
        }),
      ).toEqual({ type: "webrtc", sdp: "v=0\r\no=live-answer\r\n" })

      expect(
        yield* Realtime.connect({
          model: "gpt-realtime-2.1",
          apiKey: Redacted.make("sk-openai"),
          session: { type: "realtime", instructions: "Brief." },
          transport: { type: "webrtc", sdp: "v=0\r\no=offer\r\n", dcid: 4 },
        }),
      ).toEqual({ type: "webrtc", sdp: "v=0\r\no=rtc-answer\r\n" })

      expect(
        yield* Realtime.connect({
          model: "gpt-realtime-2.1",
          apiKey: Redacted.make("sk-openai"),
          session: { type: "realtime", instructions: "Brief." },
          transport: { type: "websocket" },
        }),
      ).toEqual({
        type: "websocket",
        url: "wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1",
        token: "ek_1",
        expiresAt: 1760000060,
      })

      expect(
        yield* Realtime.connect({
          model: "grok-voice-3.0",
          apiKey: Redacted.make("xai-key"),
          session: { voice: "ara" },
          transport: { type: "websocket" },
        }),
      ).toEqual({
        type: "websocket",
        url: "wss://api.x.ai/v1/realtime?model=grok-voice-3.0",
        token: "ek_2",
        expiresAt: 1760000120,
      })
    }).pipe(
      Effect.provide(
        dynamicResponse((input) =>
          Effect.gen(function* () {
            const req = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
            if (req.url === "https://api.openai.com/v1/live/sessions") {
              expect(req.headers.get("authorization")).toBe("Bearer sk-openai")
              expect(JSON.parse(input.text)).toEqual({
                session: { instructions: "Be concise.", voice: "marin", model: "gpt-live-1" },
                transport: { type: "webrtc", sdp: "v=0\r\no=offer\r\n", dcid: 4 },
              })
              return input.respond(
                JSON.stringify({ session: { id: "s1" }, transport: { sdp: "v=0\r\no=live-answer\r\n" } }),
              )
            }
            if (req.url === "https://api.openai.com/v1/realtime/calls?dcid=4") {
              expect(req.headers.get("authorization")).toBe("Bearer sk-openai")
              const boundary = input.text.slice(2, input.text.indexOf("\r\n"))
              const form = yield* Effect.promise(() =>
                new Response(input.text, {
                  headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
                }).formData(),
              )
              expect(form.get("sdp")).toBe("v=0\r\no=offer\r\n")
              expect(JSON.parse(String(form.get("session")))).toEqual({
                type: "realtime",
                instructions: "Brief.",
                model: "gpt-realtime-2.1",
              })
              return input.respond("v=0\r\no=rtc-answer\r\n", { headers: { "content-type": "application/sdp" } })
            }
            if (req.url === "https://api.openai.com/v1/realtime/client_secrets") {
              expect(req.headers.get("authorization")).toBe("Bearer sk-openai")
              expect(JSON.parse(input.text)).toEqual({
                expires_after: { seconds: 60 },
                session: { type: "realtime", instructions: "Brief.", model: "gpt-realtime-2.1" },
              })
              return input.respond(JSON.stringify({ value: "ek_1", expires_at: 1760000060 }))
            }
            expect(req.url).toBe("https://api.x.ai/v1/realtime/client_secrets")
            expect(req.headers.get("authorization")).toBe("Bearer xai-key")
            expect(JSON.parse(input.text)).toEqual({ expires_after: { seconds: 60 } })
            return input.respond(JSON.stringify({ value: "ek_2", expires_at: 1760000120 }))
          }),
        ),
      ),
    ),
  )

  test("routes bare and versioned model names to their engine", () => {
    expect(
      ["gpt-realtime", "gpt-realtime-2.1", "gpt-live", "grok-voice-latest"].map((model) => Realtime.engine(model)?.id),
    ).toEqual(["openai-realtime", "openai-realtime", "openai-live", "xai-realtime"])
    expect(Realtime.engine("gpt-realtimex")).toBeUndefined()
  })

  it.effect("rejects unsupported transports before network I/O", () =>
    Effect.gen(function* () {
      const liveWs = yield* Realtime.connect({
        model: "gpt-live-1",
        apiKey: Redacted.make("k"),
        transport: { type: "websocket" },
      }).pipe(Effect.flip)
      const grokRtc = yield* Realtime.connect({
        model: "grok-voice-3.0",
        apiKey: Redacted.make("k"),
        transport: { type: "webrtc", sdp: "v=0" },
      }).pipe(Effect.flip)
      expect([liveWs.reason._tag, grokRtc.reason._tag]).toEqual(["InvalidRequest", "InvalidRequest"])
    }).pipe(Effect.provide(dynamicResponse(() => Effect.die("unsupported transport reached the network")))),
  )
})
