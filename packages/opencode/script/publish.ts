#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@opencode-ai/script"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const { binaries } = await import("./build.ts")
{
  const name = `shuvcode-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`
  console.log(`smoke test: running dist/${name}/bin/shuvcode --version`)
  await $`./dist/${name}/bin/shuvcode --version`
}

// Publish binary packages first using npm with OIDC trusted publishing
// For integration channel, tag as "latest" so users get updates by default
const publishTag = Script.channel === "integration" ? "latest" : Script.channel
for (const name of Object.keys(binaries)) {
  console.log(`publishing binary package: ${name}`)
  await $`cd ./dist/${name} && npm publish --access public --tag ${publishTag}`.nothrow()
}

await $`mkdir -p ./dist/${pkg.name}`
await $`mkdir -p ./dist/${pkg.name}/bin`
await $`cp ./postinstall.mjs ./dist/${pkg.name}/postinstall.mjs`

await Bun.file(`./dist/${pkg.name}/package.json`).write(
  JSON.stringify(
    {
      name: "shuvcode",
      bin: {
        shuvcode: "./bin/shuvcode",
      },
      scripts: {
        postinstall: "node ./postinstall.mjs",
      },
      version: Script.version,
      // Reference our own binary packages (shuvcode-linux-x64, etc.)
      optionalDependencies: binaries,
      repository: {
        type: "git",
        url: "https://github.com/Latitudes-Dev/shuvcode",
      },
    },
    null,
    2,
  ),
)
// Use npm publish with OIDC trusted publishing
// For integration channel, tag as "latest" so users get updates by default
await $`cd ./dist/${pkg.name} && npm publish --access public --tag ${publishTag}`

if (!Script.preview) {
  for (const key of Object.keys(binaries)) {
    if (key.includes("linux")) {
      await $`cd dist/${key}/bin && tar -czf ../../${key}.tar.gz *`
    } else {
      await $`cd dist/${key}/bin && zip -r ../../${key}.zip *`
    }
  }

  // Skip upstream-specific publishing (AUR, Homebrew, Docker) for fork
  // These distribution channels are managed by the upstream sst/opencode project
  // Our fork publishes to npm as "shuvcode" and creates GitHub releases on kcrommett/shuvcode
  console.log("Skipping AUR, Homebrew, and Docker publishing (upstream-only)")
}
