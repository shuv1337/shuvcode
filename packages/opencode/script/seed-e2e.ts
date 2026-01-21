import fs from "node:fs/promises"
import path from "node:path"

const dir = process.env.OPENCODE_E2E_PROJECT_DIR ?? process.cwd()
const title = process.env.OPENCODE_E2E_SESSION_TITLE ?? "E2E Session"
const text = process.env.OPENCODE_E2E_MESSAGE ?? "Seeded for UI e2e"
const model = process.env.OPENCODE_E2E_MODEL ?? "opencode/gpt-5-nano"
const parts = model.split("/")
const providerID = parts[0] ?? "opencode"
const modelID = parts[1] ?? "gpt-5-nano"
const now = Date.now()

const seedModelsCache = async () => {
  const modelsPath = process.env.MODELS_DEV_API_JSON
  if (!modelsPath) return

  const file = Bun.file(modelsPath)
  if (!(await file.exists())) return

  const { Global } = await import("../src/global")
  await fs.mkdir(Global.Path.cache, { recursive: true })
  const target = path.join(Global.Path.cache, "models.json")
  await Bun.write(target, await file.text())
}

const seed = async () => {
  await seedModelsCache()
  const { Instance } = await import("../src/project/instance")
  const { InstanceBootstrap } = await import("../src/project/bootstrap")
  const { Session } = await import("../src/session")
  const { Identifier } = await import("../src/id/id")
  const { Project } = await import("../src/project/project")

  await Instance.provide({
    directory: dir,
    init: InstanceBootstrap,
    fn: async () => {
      const session = await Session.create({ title })
      const messageID = Identifier.descending("message")
      const partID = Identifier.descending("part")
      const message = {
        id: messageID,
        sessionID: session.id,
        role: "user" as const,
        time: { created: now },
        agent: "build",
        model: {
          providerID,
          modelID,
        },
      }
      const part = {
        id: partID,
        sessionID: session.id,
        messageID,
        type: "text" as const,
        text,
        time: { start: now },
      }
      await Session.updateMessage(message)
      await Session.updatePart(part)
      await Project.update({ projectID: Instance.project.id, name: "E2E Project" })
    },
  })
}

await seed()
