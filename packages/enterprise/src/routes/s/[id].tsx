import { redirect } from "@solidjs/router"
import { useParams } from "@solidjs/router"

export default function ShortRedirect() {
  const params = useParams()
  // Redirect /s/{id} to /share/{id}
  throw redirect(`/share/${params.id}`, 301)
}
