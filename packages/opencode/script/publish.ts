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
  console.log(`smoke test: running dist/${name}/bin/opencode --version`)
  await $`./dist/${name}/bin/opencode --version`
}

// Publish binary packages first
for (const name of Object.keys(binaries)) {
  console.log(`publishing binary package: ${name}`)
  await $`cp ../../.npmrc ./dist/${name}/.npmrc 2>/dev/null || true`
  await $`cd ./dist/${name} && bun publish --access public --tag ${Script.channel}`.nothrow()
}

await $`mkdir -p ./dist/${pkg.name}`
await $`cp -r ./bin ./dist/${pkg.name}/bin`

await Bun.file(`./dist/${pkg.name}/package.json`).write(
  JSON.stringify(
    {
      name: "shuvcode",
      bin: {
        shuvcode: `./bin/${pkg.name}`,
      },
      // No postinstall needed - bin/opencode is a wrapper script that finds the platform binary
      version: Script.version,
      // Reference our own binary packages (shuvcode-linux-x64, etc.)
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)
// Copy .npmrc from root if it exists (for CI auth)
await $`cp ../../.npmrc ./dist/${pkg.name}/.npmrc 2>/dev/null || true`
await $`cd ./dist/${pkg.name} && bun publish --access public --tag ${Script.channel}`

// For integration channel, also tag as latest
if (Script.channel === "integration") {
  console.log(`tagging shuvcode@${Script.version} as latest`)
  for (const name of Object.keys(binaries)) {
    await $`npm dist-tag add ${name}@${Script.version} latest`.nothrow()
  }
  await $`npm dist-tag add shuvcode@${Script.version} latest`
}

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
