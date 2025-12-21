import { WebSocketClientTransport as BaseWebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js"
import { McpError } from "@modelcontextprotocol/sdk/types.js"

export { McpError }

export interface WebSocketTransportOptions {
  headers?: Record<string, string>
}

/**
 * Extended WebSocket transport that supports custom headers.
 * Bun's WebSocket implementation accepts headers in the constructor options.
 *
 * We override start() because the base class inlines WebSocket construction
 * with no hook to customize it.
 */
export class WebSocketClientTransport extends BaseWebSocketClientTransport {
  private headers: Record<string, string>

  constructor(url: URL, options?: WebSocketTransportOptions) {
    super(url)
    this.headers = options?.headers ?? {}
  }

  override start(): Promise<void> {
    // @ts-expect-error accessing private field
    if (this._socket) {
      throw new Error(
        "WebSocketClientTransport already started! If using Client class, note that connect() calls start() automatically.",
      )
    }

    // Inject our WebSocket with headers before calling super.start()
    // @ts-expect-error accessing private field
    this._socket = new WebSocket(this._url, { headers: this.headers } as any)

    // Now delegate to base class - it will see _socket exists and wire up events
    // Unfortunately base class checks _socket at the start and throws, so we
    // must duplicate the event wiring logic
    return new Promise((resolve, reject) => {
      // @ts-expect-error accessing private field
      const socket = this._socket as WebSocket

      socket.onerror = (event) => {
        const error = "error" in event ? (event as any).error : new Error(`WebSocket error: ${JSON.stringify(event)}`)
        reject(error)
        this.onerror?.(error)
      }

      socket.onopen = () => resolve()
      socket.onclose = () => this.onclose?.()
      socket.onmessage = (event) => {
        try {
          this.onmessage?.(JSON.parse(event.data as string))
        } catch (error) {
          this.onerror?.(error as Error)
        }
      }
    })
  }

  // No-op to match HTTP transport interface (WebSocket doesn't support OAuth)
  async finishAuth(_authorizationCode: string): Promise<void> {}
}
