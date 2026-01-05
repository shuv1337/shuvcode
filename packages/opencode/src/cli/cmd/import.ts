import type { Argv } from "yargs"
import { Session } from "../../session"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Storage } from "../../storage/storage"
import { Instance } from "../../project/instance"
import { EOL } from "os"

export const ImportCommand = cmd({
  command: "import <file>",
  describe: "import session data from JSON file or URL",
  builder: (yargs: Argv) => {
    return yargs.positional("file", {
      describe: "path to JSON file or opencode.ai share URL",
      type: "string",
      demandOption: true,
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      let exportData:
        | {
            info: Session.Info
            messages: Array<{
              info: any
              parts: any[]
            }>
          }
        | undefined

      const isUrl = args.file.startsWith("http://") || args.file.startsWith("https://")

      if (isUrl) {
        // Match upstream (opncd.ai) and enterprise (shuv.ai) URLs
        const upstreamMatch = args.file.match(/https?:\/\/opncd\.ai\/share\/([a-zA-Z0-9_-]+)/)
        const enterpriseMatch = args.file.match(/https?:\/\/(?:share\.)?shuv\.ai\/(?:share|s)\/([a-zA-Z0-9_-]+)/)

        const isUpstream = !!upstreamMatch
        const isShuv = !!enterpriseMatch
        const slug = upstreamMatch?.[1] ?? enterpriseMatch?.[1]

        if (!slug) {
          process.stdout.write(`Invalid URL format. Expected:`)
          process.stdout.write(EOL)
          process.stdout.write(`  - https://opncd.ai/share/<slug>`)
          process.stdout.write(EOL)
          process.stdout.write(`  - https://share.shuv.ai/share/<slug>`)
          process.stdout.write(EOL)
          return
        }

        if (isShuv) {
          // Enterprise API format
          const response = await fetch(`https://share.shuv.ai/api/share/${slug}/data`)
          if (!response.ok) {
            process.stdout.write(`Failed to fetch share data: ${response.statusText}`)
            process.stdout.write(EOL)
            return
          }

          const data = (await response.json()) as Array<{
            type: "session" | "message" | "part" | "session_diff" | "model"
            data: any
          }>

          // Transform enterprise format to standard format
          let info: Session.Info | undefined
          const messagesMap: Record<string, { info: any; parts: any[] }> = {}

          for (const item of data) {
            if (item.type === "session") {
              info = item.data
            } else if (item.type === "message") {
              const msgId = item.data.id
              messagesMap[msgId] = messagesMap[msgId] ?? { info: item.data, parts: [] }
              messagesMap[msgId].info = item.data
            } else if (item.type === "part") {
              const msgId = item.data.messageID
              messagesMap[msgId] = messagesMap[msgId] ?? { info: {}, parts: [] }
              messagesMap[msgId].parts.push(item.data)
            }
          }

          if (!info) {
            process.stdout.write(`Share not found: ${slug}`)
            process.stdout.write(EOL)
            return
          }

          exportData = {
            info,
            messages: Object.values(messagesMap),
          }
        } else {
          // Upstream API format (opncd.ai)
          const response = await fetch(`https://opncd.ai/api/share/${slug}`)
          if (!response.ok) {
            process.stdout.write(`Failed to fetch share data: ${response.statusText}`)
            process.stdout.write(EOL)
            return
          }

          const data = await response.json()

          if (!data.info || !data.messages || Object.keys(data.messages).length === 0) {
            process.stdout.write(`Share not found: ${slug}`)
            process.stdout.write(EOL)
            return
          }

          exportData = {
            info: data.info,
            messages: Object.values(data.messages).map((msg: any) => {
              const { parts, ...info } = msg
              return { info, parts }
            }),
          }
        }
      } else {
        const file = Bun.file(args.file)
        exportData = await file.json().catch(() => {})
        if (!exportData) {
          process.stdout.write(`File not found: ${args.file}`)
          process.stdout.write(EOL)
          return
        }
      }

      if (!exportData) {
        process.stdout.write(`Failed to read session data`)
        process.stdout.write(EOL)
        return
      }

      await Storage.write(["session", Instance.project.id, exportData.info.id], exportData.info)

      for (const msg of exportData.messages) {
        await Storage.write(["message", exportData.info.id, msg.info.id], msg.info)

        for (const part of msg.parts) {
          await Storage.write(["part", msg.info.id, part.id], part)
        }
      }

      process.stdout.write(`Imported session: ${exportData.info.id}`)
      process.stdout.write(EOL)
    })
  },
})
