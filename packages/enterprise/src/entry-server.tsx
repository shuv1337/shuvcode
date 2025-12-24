// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server"

export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html
        lang="en"
        data-theme="nightowl"
        style="--font-family-sans: 'Meslo', 'Menlo', 'Monaco', 'Courier New', monospace; --font-family-mono: 'Meslo', 'Menlo', 'Monaco', 'Courier New', monospace;"
      >
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>shuvcode</title>
          <meta name="theme-color" content="#011627" />
          <meta name="theme-color" content="#011627" media="(prefers-color-scheme: dark)" />
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
          <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/meslo@1.0.0/meslo.css" />
          {assets}
        </head>
        <body class="antialiased overscroll-none text-12-regular">
          <div id="app">{children}</div>
          {scripts}
        </body>
      </html>
    )}
  />
))
