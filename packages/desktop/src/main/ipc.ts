import { execFile } from "node:child_process"
import { stat } from "node:fs/promises"
import { basename, join } from "node:path"
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron"
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron"
import { parseDesktopNativeBundle, type DesktopNativeBundle } from "@opencode-ai/app/i18n/desktop-native"

import {
  Ipc,
  sendIpcEvent,
  type FatalRendererError,
  type IpcInvoke,
  type IpcInvokeArgs,
  type IpcInvokeResult,
  type IpcSend,
  type ServerReadyData,
} from "../shared/ipc-contract"
import { runDesktopMenuAction } from "./desktop-menu-actions"
import { setForceFocus } from "./debug"
import { assertAttachmentBudget, createPickedFileAuthorizations } from "./attachment-picker"
import { getStore, removeStoreFileIfEmpty } from "./store"
import {
  getPinchZoomEnabled,
  getWindowID,
  openExternalURL,
  openLocalFileURL,
  setPinchZoomEnabled,
  setTitlebar,
  updateTitlebar,
} from "./windows"
import { createDesktopDraftStore } from "./draft-store"
import { nativeT } from "./native-translations"
import type { UpdaterIpc } from "./updater"
import type { WslIpc } from "./wsl/ipc"

type MaybePromise<Value> = Value | Promise<Value>

function handle<Channel extends keyof IpcInvoke>(
  channel: Channel,
  listener: (event: IpcMainInvokeEvent, ...args: IpcInvokeArgs<Channel>) => MaybePromise<IpcInvokeResult<Channel>>,
) {
  ipcMain.handle(channel, listener)
}

function on<Channel extends keyof IpcSend>(
  channel: Channel,
  listener: (event: IpcMainEvent, ...args: IpcSend[Channel]) => void,
) {
  ipcMain.on(channel, listener)
}

const pickerFilters = (ext?: string[]) => {
  if (!ext || ext.length === 0) return undefined
  return [{ name: nativeT("desktop.dialog.files"), extensions: ext }]
}

const pickedFiles = createPickedFileAuthorizations()

type Deps = {
  relaunch: () => void
  awaitInitialization: () => Promise<ServerReadyData>
  consumeInitialDeepLinks: () => Promise<string[]> | string[]
  getDefaultServerUrl: () => Promise<string | null> | string | null
  setDefaultServerUrl: (url: string | null) => Promise<void> | void
  isFirstLaunchOnboardingPending: () => Promise<boolean> | boolean
  finishFirstLaunchOnboarding: (createDefaultProject: boolean) => Promise<string | null> | string | null
  checkAppExists: (appName: string) => Promise<boolean> | boolean
  resolveAppPath: (appName: string) => Promise<string | null>
  showUpdater: () => Promise<void> | void
  setBackgroundColor: (color: string) => void
  exportDebugLogs: () => Promise<string>
  recordFatalRendererError: (error: FatalRendererError) => Promise<void> | void
  setNativeTranslations: (bundle: DesktopNativeBundle) => void
}

export function registerIpcHandlers(deps: Deps) {
  const drafts = createDesktopDraftStore(join(app.getPath("userData"), "drafts.sqlite"))
  app.on("before-quit", () => drafts.flush())
  app.once("will-quit", () => drafts.close())
  app.on("browser-window-created", (_event, win) => win.on("session-end", () => drafts.flush()))

  handle(Ipc.app.awaitInitialization, () => deps.awaitInitialization())
  handle(Ipc.app.consumeInitialDeepLinks, () => deps.consumeInitialDeepLinks())
  handle(Ipc.app.getDefaultServerUrl, () => deps.getDefaultServerUrl())
  handle(Ipc.app.setDefaultServerUrl, (_event, url) => deps.setDefaultServerUrl(url))
  handle(Ipc.app.isFirstLaunchOnboardingPending, () => deps.isFirstLaunchOnboardingPending())
  handle(Ipc.app.finishFirstLaunchOnboarding, (_event, createDefaultProject) =>
    deps.finishFirstLaunchOnboarding(createDefaultProject),
  )
  handle(Ipc.app.checkAppExists, (_event, appName) => deps.checkAppExists(appName))
  handle(Ipc.app.resolveAppPath, (_event, appName) => deps.resolveAppPath(appName))
  handle(Ipc.app.setBackgroundColor, (_event, color) => deps.setBackgroundColor(color))
  handle(Ipc.app.exportDebugLogs, () => deps.exportDebugLogs())
  handle(Ipc.app.setForceFocus, (event, enabled) => setForceFocus(event.sender, enabled))
  handle(Ipc.app.recordFatalRendererError, (_event, error) => deps.recordFatalRendererError(error))
  handle(Ipc.app.setNativeTranslations, (event, value) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed() || win.webContents !== event.sender || event.senderFrame !== event.sender.mainFrame) {
      throw new Error("Invalid native translation sender")
    }
    const bundle = parseDesktopNativeBundle(value)
    if (!bundle) throw new Error("Invalid native translation bundle")
    deps.setNativeTranslations(bundle)
  })
  handle(Ipc.storage.get, (_event, name, key) => {
    try {
      const store = getStore(name)
      const value = store.get(key)
      if (value === undefined || value === null) return null
      return typeof value === "string" ? value : JSON.stringify(value)
    } catch {
      return null
    }
  })
  handle(Ipc.storage.set, (_event, name, key, value) => {
    getStore(name).set(key, value)
  })
  handle(Ipc.storage.delete, (_event, name, key) => {
    getStore(name).delete(key)
    void removeStoreFileIfEmpty(name)
  })
  handle(Ipc.storage.clear, (_event, name) => {
    getStore(name).clear()
    void removeStoreFileIfEmpty(name)
  })
  handle(Ipc.storage.keys, (_event, name) => {
    const store = getStore(name)
    return Object.keys(store.store)
  })
  handle(Ipc.storage.length, (_event, name) => {
    const store = getStore(name)
    return Object.keys(store.store).length
  })
  handle(Ipc.drafts.get, (_event, key) => drafts.get(key))
  handle(Ipc.drafts.set, (_event, key, value) => drafts.set(key, value))
  handle(Ipc.drafts.delete, (_event, key) => drafts.set(key, null))
  handle(Ipc.drafts.putBlob, (_event, data) => drafts.putBlob(new Uint8Array(data)))
  handle(Ipc.drafts.getBlob, (_event, id) => {
    const data = drafts.getBlob(id)
    return data ? new Uint8Array(data).buffer : null
  })

  handle(Ipc.files.openDirectoryPicker, async (_event, opts) => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", ...(opts?.multiple ? ["multiSelections" as const] : []), "createDirectory"],
      title: opts?.title ?? nativeT("desktop.dialog.chooseFolder"),
      defaultPath: opts?.defaultPath,
    })
    if (result.canceled) return null
    return opts?.multiple ? result.filePaths : result.filePaths[0]
  })

  handle(Ipc.files.openFilePicker, async (event, opts) => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", ...(opts?.multiple ? ["multiSelections" as const] : [])],
      title: opts?.title ?? nativeT("desktop.dialog.chooseFile"),
      defaultPath: opts?.defaultPath,
      filters: pickerFilters(opts?.extensions),
    })
    if (result.canceled) return null
    const files = await Promise.all(
      result.filePaths.map(async (filePath) => ({
        path: filePath,
        name: basename(filePath),
        size: (await stat(filePath)).size,
      })),
    )
    assertAttachmentBudget(files)
    const token = pickedFiles.add(event.sender.id, result.filePaths)
    return { token, files }
  })

  handle(Ipc.files.readPickedFile, async (event, token, filePath) => {
    return pickedFiles.read(event.sender.id, token, filePath)
  })

  handle(Ipc.files.releasePickedFiles, (event, token) => {
    pickedFiles.release(event.sender.id, token)
  })

  handle(Ipc.files.saveFilePicker, async (_event, opts) => {
    const result = await dialog.showSaveDialog({
      title: opts?.title ?? nativeT("desktop.dialog.saveFile"),
      defaultPath: opts?.defaultPath,
    })
    if (result.canceled) return null
    return result.filePath ?? null
  })

  on(Ipc.files.openExternal, (_event, url) => {
    openExternalURL(url)
  })

  on(Ipc.files.openLocalFile, (_event, url) => {
    openLocalFileURL(url)
  })

  handle(Ipc.files.openPath, async (_event, path, app) => {
    if (!app) return shell.openPath(path)
    await new Promise<void>((resolve, reject) => {
      const [cmd, args] =
        process.platform === "darwin" ? (["open", ["-a", app, path]] as const) : ([app, [path]] as const)
      execFile(cmd, args, (err) => (err ? reject(err) : resolve()))
    })
  })

  handle(Ipc.files.revealPath, async (_event, path) => {
    const exists = await stat(path).then(
      () => true,
      () => false,
    )
    if (!exists) return false
    shell.showItemInFolder(path)
    return true
  })

  handle(Ipc.files.readClipboardImage, () => {
    const image = clipboard.readImage()
    if (image.isEmpty()) return null
    const buffer = new Uint8Array(image.toPNG()).buffer
    const size = image.getSize()
    return { buffer, width: size.width, height: size.height }
  })

  handle(Ipc.window.getId, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error("Window not found")
    const id = getWindowID(win)
    if (!id) throw new Error("Window ID not found")
    return id
  })

  handle(Ipc.window.getFocused, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isFocused() ?? false
  })

  handle(Ipc.window.getFullscreen, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isFullScreen() ?? false
  })

  handle(Ipc.window.setFocus, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.focus()
  })

  handle(Ipc.window.show, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.show()
  })

  on(Ipc.app.relaunch, () => {
    deps.relaunch()
  })

  handle(Ipc.window.getZoomFactor, (event) => event.sender.getZoomFactor())
  handle(Ipc.window.setZoomFactor, (event, factor) => {
    event.sender.setZoomFactor(factor)
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    updateTitlebar(win)
  })
  handle(Ipc.window.getPinchZoomEnabled, () => getPinchZoomEnabled())
  handle(Ipc.window.setPinchZoomEnabled, (_event, enabled) => {
    setPinchZoomEnabled(enabled)
  })
  handle(Ipc.window.setTitlebar, (event, theme) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    setTitlebar(win, theme)
  })
  handle(Ipc.menu.runAction, (event, action) => {
    runDesktopMenuAction(BrowserWindow.fromWebContents(event.sender), action, {
      checkForUpdates: () => void deps.showUpdater(),
      relaunch: deps.relaunch,
    })
  })
}

export function registerUpdaterIpcHandlers(updater: UpdaterIpc) {
  handle(Ipc.updater.subscribe, (event) => updater.subscribe(event.sender))
  handle(Ipc.updater.unsubscribe, (event) => updater.unsubscribe(event.sender.id))
  handle(Ipc.updater.check, () => updater.check())
  handle(Ipc.updater.install, () => updater.install())
}

export function registerWslIpcHandlers(wsl: WslIpc) {
  handle(Ipc.wsl.subscribe, (event) => wsl.subscribe(event.sender))
  handle(Ipc.wsl.unsubscribe, (event) => wsl.unsubscribe(event.sender.id))
  handle(Ipc.wsl.getState, () => wsl.getState())
  handle(Ipc.wsl.probeRuntime, () => wsl.probeRuntime())
  handle(Ipc.wsl.refreshDistros, () => wsl.refreshDistros())
  handle(Ipc.wsl.installWsl, () => wsl.installWsl())
  handle(Ipc.wsl.installDistro, (_event, value) => wsl.installDistro(value))
  handle(Ipc.wsl.probeAddable, (_event, value) => wsl.probeAddable(value))
  handle(Ipc.wsl.installOpencode, (_event, value) => wsl.installOpencode(value))
  handle(Ipc.wsl.openTerminal, (_event, value) => wsl.openTerminal(value))
  handle(Ipc.wsl.addServer, (_event, value) => wsl.addServer(value))
  handle(Ipc.wsl.removeServer, (_event, value) => wsl.removeServer(value))
  handle(Ipc.wsl.startServer, (_event, value) => wsl.startServer(value))
}

export function sendMenuCommand(win: BrowserWindow, id: string) {
  sendIpcEvent(win.webContents, Ipc.menu.command, id)
}

export function sendDeepLinks(win: BrowserWindow, urls: string[]) {
  sendIpcEvent(win.webContents, Ipc.app.deepLink, urls)
}
