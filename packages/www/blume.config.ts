import { defineConfig } from "blume"

export default defineConfig({
  title: "Shuvcode",
  description: "The open source AI coding agent.",
  basePath: "/docs",
  logo: {
    image: {
      light: "/assets/logo-light.svg",
      dark: "/assets/logo-dark.svg",
      alt: "Shuvcode",
    },
    text: "",
    href: "/",
  },
  content: {
    root: "content/docs",
  },
  github: {
    owner: "Latitudes-Dev",
    repo: "shuvcode",
    branch: "dev",
    dir: "packages/www",
  },
  navigation: {
    tabs: [
      { label: "Docs", path: "/" },
      { label: "Build", path: "/build" },
      { label: "API", path: "/api" },
    ],
  },
  openapi: {
    enabled: true,
    route: "/api",
    spec: "./openapi.json",
  },
  deployment: {
    adapter: "cloudflare",
    base: "/v2/",
    output: "server",
    site: process.env.BLUME_ENV === "dev" ? "https://dev.shuv.ai" : "https://shuv.ai",
  },
})
