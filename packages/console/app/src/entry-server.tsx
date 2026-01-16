// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server"
import type { JSX } from "solid-js"

const criticalCSS = `[data-component="top"]{min-height:80px;display:flex;align-items:center}`

export default createHandler(
  () => (
    <StartServer
      document={({
        assets,
        children,
        scripts,
      }: {
        assets: JSX.Element
        children: JSX.Element
        scripts: JSX.Element
      }) => (
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <meta property="og:image" content="/social-share.png" />
            <meta property="twitter:image" content="/social-share.png" />
            <style>{criticalCSS}</style>
            {assets}
          </head>
          <body>
            <div id="app">{children}</div>
            {scripts}
          </body>
        </html>
      )}
    />
  ),
  {
    mode: "async",
  },
)
