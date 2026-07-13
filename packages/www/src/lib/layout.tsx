import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared"

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: "OpenCode",
      url: "/",
    },
    links: [
      {
        text: "Docs",
        url: "/docs",
        active: "nested-url",
      },
      {
        text: "GitHub",
        url: "https://github.com/anomalyco/opencode",
        external: true,
      },
    ],
  }
}
