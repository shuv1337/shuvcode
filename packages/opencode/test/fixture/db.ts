import { rm } from "fs/promises"
import { InstallationDatabase } from "@/installation/database"
import { disposeAllInstances } from "./fixture"

export async function resetDatabase() {
  await disposeAllInstances().catch(() => undefined)
  const dbPath = InstallationDatabase.path()
  await rm(dbPath, { force: true }).catch(() => undefined)
  await rm(`${dbPath}-wal`, { force: true }).catch(() => undefined)
  await rm(`${dbPath}-shm`, { force: true }).catch(() => undefined)
}
