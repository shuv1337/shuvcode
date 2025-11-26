#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@opencode-ai/script"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const { binaries } = await import("./build.ts")
{
  const name = `${pkg.name}-${process.platform}-${process.arch}`
  console.log(`smoke test: running dist/${name}/bin/opencode --version`)
  await $`./dist/${name}/bin/opencode --version`
}

await $`mkdir -p ./dist/${pkg.name}`
await $`cp -r ./bin ./dist/${pkg.name}/bin`
await $`cp ./script/postinstall.mjs ./dist/${pkg.name}/postinstall.mjs`

await Bun.file(`./dist/${pkg.name}/package.json`).write(
  JSON.stringify(
    {
      name: "shuvcode",
      bin: {
        shuvcode: `./bin/${pkg.name}`,
      },
      scripts: {
        postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
      },
      version: Script.version,
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)
// Skip binary package publishing (we don't own those NPM names)
// Just publish the main CLI package
// Copy .npmrc from root if it exists (for CI auth)
await $`cp ../../.npmrc ./dist/${pkg.name}/.npmrc 2>/dev/null || true`
await $`cd ./dist/${pkg.name} && bun publish --access public --tag ${Script.channel}`

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
