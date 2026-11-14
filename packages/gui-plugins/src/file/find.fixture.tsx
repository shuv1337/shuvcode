import { render } from "solid-js/web"
import { createPreviewFind, findableHtml } from "./find"

export function mountPreviewFind(frame: boolean) {
  const host = document.createElement("div")
  host.dataset.testid = "preview-find-fixture"
  document.body.append(host)
  render(() => {
    const find = createPreviewFind({ root: () => host, active: () => true })
    const content = findableHtml({ type: "text", content: "<p>İx A.b a.b 𐐀</p>" })

    return (
      <>
        {frame ? (
          <iframe
            data-file-find="frame"
            sandbox="allow-scripts"
            srcdoc={content.type === "text" ? content.content : ""}
          />
        ) : (
          <p data-file-find="document">İx A.b a.b 𐐀</p>
        )}
        <button onClick={() => find.open()}>Open preview find</button>
        <input aria-label="Preview query" onInput={(event) => find.setQuery(event.currentTarget.value)} />
        <output aria-label="Match count">{find.state()?.count}</output>
      </>
    )
  }, host)
}
