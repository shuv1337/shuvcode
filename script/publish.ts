#!/usr/bin/env bun

import { $ } from "bun"
import { Script } from "@opencode-ai/script"

const notes = [] as string[]

console.log("=== publishing ===\n")

if (!Script.preview) {
  const previous = await fetch("https://registry.npmjs.org/shuvcode/latest")
    .then((res) => {
      if (!res.ok) throw new Error(res.statusText)
      return res.json()
    })
    .then((data: any) => data.version)

  // Use base version (without -N suffix) for git log since tags follow upstream naming
  const previousBase = previous.replace(/-\d+$/, "")
  const log =
    await $`git log v${previousBase}..HEAD --oneline --format="%h %s" -- packages/opencode packages/sdk packages/plugin`.text()

  // For the fork, use commit messages directly as changelog (no AI generation)
  const commits = log.split("\n").filter((line) => line && !line.match(/^\w+ (ignore:|test:|chore:|ci:|release:)/i))

  for (const commit of commits) {
    // Extract just the message part (after the hash)
    const message = commit.replace(/^\w+\s+/, "")
    if (message) {
      // Capitalize first letter
      notes.push(`- ${message.charAt(0).toUpperCase()}${message.slice(1)}`)
    }
  }
  console.log("---- Changelog ----")
  console.log(notes.join("\n"))
  console.log("-------------------")

  // Get contributors
  const team = [
    "actions-user",
    "opencode",
    "rekram1-node",
    "thdxr",
    "kommander",
    "jayair",
    "fwang",
    "adamdotdevin",
    "iamdavidhill",
    "opencode-agent[bot]",
  ]
  const compare =
    await $`gh api "/repos/Latitudes-Dev/shuvcode/compare/v${previous}...HEAD" --jq '.commits[] | {login: .author.login, message: .commit.message}'`.text()
  const contributors = new Map<string, string[]>()

  for (const line of compare.split("\n").filter(Boolean)) {
    const { login, message } = JSON.parse(line) as { login: string | null; message: string }
    const title = message.split("\n")[0] ?? ""
    if (title.match(/^(ignore:|test:|chore:|ci:|release:)/i)) continue

    if (login && !team.includes(login)) {
      if (!contributors.has(login)) contributors.set(login, [])
      contributors.get(login)?.push(title)
    }
  }

  if (contributors.size > 0) {
    notes.push("")
    notes.push(`**Thank you to ${contributors.size} community contributor${contributors.size > 1 ? "s" : ""}:**`)
    for (const [username, userCommits] of contributors) {
      notes.push(`- @${username}:`)
      for (const commit of userCommits) {
        notes.push(`  - ${commit}`)
      }
    }
  }
}

const pkgjsons = await Array.fromAsync(
  new Bun.Glob("**/package.json").scan({
    absolute: true,
  }),
).then((arr) => arr.filter((x) => !x.includes("node_modules") && !x.includes("dist")))

for (const file of pkgjsons) {
  let pkg = await Bun.file(file).text()
  pkg = pkg.replaceAll(/"version": "[^"]+"/g, `"version": "${Script.version}"`)
  console.log("updated:", file)
  await Bun.file(file).write(pkg)
}

const extensionToml = new URL("../packages/extensions/zed/extension.toml", import.meta.url).pathname
let toml = await Bun.file(extensionToml).text()
toml = toml.replace(/^version = "[^"]+"/m, `version = "${Script.version}"`)
toml = toml.replaceAll(/releases\/download\/v[^/]+\//g, `releases/download/v${Script.version}/`)
console.log("updated:", extensionToml)
await Bun.file(extensionToml).write(toml)

await $`bun install`

console.log("\n=== opencode ===\n")
await import(`../packages/opencode/script/publish.ts`)

console.log("\n=== sdk ===\n")
await import(`../packages/sdk/js/script/publish.ts`)

console.log("\n=== plugin ===\n")
await import(`../packages/plugin/script/publish.ts`)

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

if (!Script.preview) {
  await $`git commit -am "release: v${Script.version}"`
  await $`git tag v${Script.version}`
  await $`git fetch origin`
  await $`git cherry-pick HEAD..origin/integration`.nothrow()
  await $`git push origin HEAD --tags --no-verify --force-with-lease`
  await new Promise((resolve) => setTimeout(resolve, 5_000))
  await $`gh release create v${Script.version} --repo Latitudes-Dev/shuvcode -d --title "v${Script.version}" --notes ${notes.join("\n") || "No notable changes"} ./packages/opencode/dist/*.zip ./packages/opencode/dist/*.tar.gz`
  const release = await $`gh release view v${Script.version} --repo Latitudes-Dev/shuvcode --json id,tagName`.json()
  if (process.env.GITHUB_OUTPUT) {
    // Use heredoc delimiter for multiline changelog output
    const delimiter = `CHANGELOG_EOF_${Date.now()}`
    const output = [
      `releaseId=${release.id}`,
      `tagName=${release.tagName}`,
      `changelog<<${delimiter}`,
      notes.join("\n"),
      delimiter,
      "",
    ].join("\n")
    await Bun.write(process.env.GITHUB_OUTPUT, output)
  }
}
