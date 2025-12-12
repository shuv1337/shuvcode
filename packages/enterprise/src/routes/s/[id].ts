import type { APIEvent } from "@solidjs/start/server"

export function GET(event: APIEvent) {
  const url = new URL(event.request.url)
  const id = url.pathname.split("/").pop()
  return new Response(null, {
    status: 301,
    headers: {
      Location: `/share/${id}`,
    },
  })
}
