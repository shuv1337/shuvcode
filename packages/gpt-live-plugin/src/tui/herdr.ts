/**
 * herdr (terminal workspace manager) accepts kitty images printed by programs but does
 * not display them; it offers its own pane graphics API instead. This streams RGBA frames
 * over herdr's socket to a layer placed at a cell rectangle inside the current pane.
 */
import { connect, type Socket } from "node:net"

export interface HerdrPane {
  socket: string
  paneID: string
}

export function detectHerdr(env: NodeJS.ProcessEnv = process.env): HerdrPane | undefined {
  if (env.HERDR_ENV !== "1" || !env.HERDR_SOCKET_PATH || !env.HERDR_PANE_ID) return undefined
  return { socket: env.HERDR_SOCKET_PATH, paneID: env.HERDR_PANE_ID }
}

export interface Placement {
  col: number
  row: number
  cols: number
  rows: number
}

/** A pane.graphics.stream connection. Frames are dropped while the socket is congested. */
export class HerdrStream {
  private socket: Socket | undefined
  private ready = false
  private congested = false
  private failed = false
  private opening = false

  constructor(
    private readonly pane: HerdrPane,
    private readonly layer = "gptlive-wave",
    private readonly onFailure?: (error: string) => void,
  ) {}

  get usable() {
    return !this.failed
  }

  private open() {
    if (this.socket || this.opening || this.failed) return
    this.opening = true
    const socket = connect(this.pane.socket)
    this.socket = socket
    let buffer = ""
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8")
      const newline = buffer.indexOf("\n")
      if (newline < 0) return
      const line = buffer.slice(0, newline)
      socket.off("data", onData)
      this.opening = false
      try {
        const reply = JSON.parse(line) as { result?: { type?: string }; error?: { message?: string } }
        if (reply.result?.type === "ok") {
          this.ready = true
          return
        }
        this.fail(reply.error?.message ?? line)
      } catch {
        this.fail(line)
      }
    }
    socket.on("data", onData)
    socket.on("drain", () => {
      this.congested = false
    })
    socket.on("error", (error) => this.fail(String(error)))
    socket.on("close", () => {
      this.socket = undefined
      this.ready = false
      this.opening = false
    })
    socket.write(
      `${JSON.stringify({
        id: "gptlive-wave",
        method: "pane.graphics.stream",
        params: { pane_id: this.pane.paneID, layer_id: this.layer, z_index: 1 },
      })}\n`,
    )
  }

  private fail(error: string) {
    if (this.failed) return
    this.failed = true
    this.close()
    this.onFailure?.(error)
  }

  /** Sends one RGBA frame; returns false if it was skipped. */
  send(pixels: Uint8Array, width: number, height: number, placement: Placement) {
    this.open()
    if (!this.ready || this.congested || !this.socket) return false
    const header = {
      format: "rgba",
      image_width: width,
      image_height: height,
      data_length: pixels.byteLength,
      placement: {
        viewport_col: placement.col,
        viewport_row: placement.row,
        grid_cols: placement.cols,
        grid_rows: placement.rows,
      },
    }
    this.socket.write(`${JSON.stringify(header)}\n`)
    const flushed = this.socket.write(pixels)
    if (!flushed) this.congested = true
    return true
  }

  /** Closing the stream removes its layer from the pane. */
  close() {
    this.ready = false
    this.opening = false
    const socket = this.socket
    this.socket = undefined
    socket?.end()
    socket?.destroy()
  }
}
