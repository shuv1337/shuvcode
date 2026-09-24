import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { createServer } from "node:net"
import os from "node:os"
import path from "node:path"

import { HerdrStream, detectHerdr } from "../src/tui/herdr"

describe("herdr detection", () => {
  test("requires the herdr pane environment", () => {
    expect(detectHerdr({})).toBeUndefined()
    expect(detectHerdr({ HERDR_ENV: "1", HERDR_SOCKET_PATH: "/s", HERDR_PANE_ID: "w1:p1" })).toEqual({
      socket: "/s",
      paneID: "w1:p1",
    })
  })
})

describe("herdr stream", () => {
  test("opens a graphics stream, then sends a JSON header and exactly the frame bytes", async () => {
    const socketPath = path.join(mkdtempSync(path.join(os.tmpdir(), "herdr-")), "h.sock")
    const received: Buffer[] = []
    const opened = Promise.withResolvers<Record<string, any>>()
    const server = createServer((socket) => {
      let greeted = false
      socket.on("data", (chunk: Buffer) => {
        if (!greeted) {
          greeted = true
          const newline = chunk.indexOf(10)
          opened.resolve(JSON.parse(chunk.subarray(0, newline).toString()))
          socket.write(`${JSON.stringify({ id: "gptlive-wave", result: { type: "ok" } })}\n`)
          if (chunk.length > newline + 1) received.push(chunk.subarray(newline + 1))
          return
        }
        received.push(chunk)
      })
    })
    await new Promise<void>((resolve) => server.listen(socketPath, resolve))

    const stream = new HerdrStream({ socket: socketPath, paneID: "w1:p1" })
    const pixels = new Uint8Array(4 * 3 * 2).fill(7)
    const placement = { col: 2, row: 5, cols: 3, rows: 2 }
    expect(stream.send(pixels, 3, 2, placement)).toBe(false) // not ready until herdr replies
    const request = await opened.promise
    expect(request.method).toBe("pane.graphics.stream")
    expect(request.params).toEqual({ pane_id: "w1:p1", layer_id: "gptlive-wave", z_index: 1 })
    await Bun.sleep(30)
    expect(stream.send(pixels, 3, 2, placement)).toBe(true)
    await Bun.sleep(30)

    const data = Buffer.concat(received)
    const newline = data.indexOf(10)
    const header = JSON.parse(data.subarray(0, newline).toString())
    expect(header).toEqual({
      format: "rgba",
      image_width: 3,
      image_height: 2,
      data_length: 24,
      placement: { viewport_col: 2, viewport_row: 5, grid_cols: 3, grid_rows: 2 },
    })
    expect(data.subarray(newline + 1).length).toBe(24)
    stream.close()
    server.close()
  })
})
