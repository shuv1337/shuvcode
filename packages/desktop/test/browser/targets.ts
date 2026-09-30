import assert from "node:assert/strict"
import type { BrowserWindow } from "electron"
import type { BrowserPaneElement } from "@opencode/app/desktop"
import { Browser } from "@opencode/plugin-browser/rpc"
import { Schema } from "effect"
import { createBrowserPage } from "../../src/main/browser-chromium"
import { createCornerImages } from "../../src/main/browser/corners"

export async function verifyTargets(win: BrowserWindow, url: string) {
  const children = win.contentView.children.length
  const tabID = Browser.TabID.make(`tab_${crypto.randomUUID()}`)
  const inspections: { active: boolean; element?: BrowserPaneElement }[] = []
  const page = createBrowserPage(win, {
    id: tabID,
    partition: `target-test-${crypto.randomUUID()}`,
    network: null,
    publish() {},
    inspect: (event) => inspections.push(event),
    fail() {
      throw new Error("Target test page failed")
    },
    popup() {
      throw new Error("Unexpected popup")
    },
  })
  const execute = (action: Browser.Action, target?: Browser.Target) =>
    page.execute({ action, files: [], target }, new AbortController().signal)
  const inspect = async (action: Browser.Action) => {
    const result = await page.execute({ action, files: [], inspect: true }, new AbortController().signal)
    assert.equal(result.files.length, 0)
    return Schema.decodeUnknownSync(Browser.Target)(result.value)
  }
  try {
    await page.ready
    const started = new Promise<void>((resolve) => page.contents.once("did-navigate", () => resolve()))
    page.setVisible(true)
    const navigation = execute({ type: "navigate", tabID, url: url + "/loading" })
    await started
    assert(page.state().loading)
    assert(win.contentView.children.slice(children).every((view) => !view.getVisible()))
    page.setVisible(true)
    assert(win.contentView.children.slice(children).every((view) => !view.getVisible()))
    const stopped = new Promise<void>((resolve) => page.contents.once("did-stop-loading", () => resolve()))
    await fetch(url + "/finish-loading")
    await navigation
    await stopped
    assert.equal(page.state().loading, false)
    assert(page.view.getVisible(), "The requested visibility must return after loading finishes")
    console.log("PASS native loading from a blank page keeps the themed background visible until the document is ready")
    const again = new Promise<void>((resolve) => page.contents.once("did-navigate", () => resolve()))
    const reloading = execute({ type: "navigate", tabID, url: url + "/loading" })
    await again
    assert(page.state().loading)
    assert(page.view.getVisible(), "A shown page must stay visible while the next document loads")
    await fetch(url + "/finish-loading")
    await reloading
    assert(page.view.getVisible())
    console.log("PASS native loading from a shown page keeps the previous document visible")
    await execute({ type: "navigate", tabID, url: url + "/missing" })
    assert.equal(page.state().loadError, undefined, "An HTTP error page from the server is a real document")
    page.setVisible(true)
    assert(page.view.getVisible(), "An HTTP error page from the server must stay visible")
    console.log("PASS native HTTP error pages stay visible")
    await assert.rejects(execute({ type: "navigate", tabID, url: url + "/unreachable" }), /ERR_EMPTY_RESPONSE/)
    assert.equal(page.state().loadError, "ERR_EMPTY_RESPONSE")
    assert.equal(page.state().url, url + "/unreachable")
    page.setVisible(true)
    assert(win.contentView.children.slice(children).every((view) => !view.getVisible()))
    const clearing = new Promise<void>((resolve) => {
      page.contents.once("did-start-navigation", () => {
        page.setVisible(true)
        assert(win.contentView.children.slice(children).every((view) => !view.getVisible()))
        resolve()
      })
    })
    await execute({ type: "navigate", tabID, url: "about:blank" })
    await clearing
    assert.equal(page.state().loadError, undefined)
    page.setVisible(true)
    assert(win.contentView.children.slice(children).every((view) => !view.getVisible()))
    const restored = new Promise<void>((resolve) => page.contents.once("did-stop-loading", () => resolve()))
    await execute({ type: "navigate", tabID, url })
    await restored
    page.setVisible(true)
    assert(page.view.getVisible())
    console.log("PASS native blank navigation stays hidden through stale layout updates")
    for (const color of [
      [255, 255, 255, 255],
      [20, 24, 30, 255],
      [40, 100, 160, 255],
    ] as const) {
      const images = createCornerImages(color, 10, 1)
      const left = images[0].toBitmap()
      const right = images[1].toBitmap()
      assert.deepEqual([...left.subarray(9 * 10 * 4, 9 * 10 * 4 + 4)], [color[2], color[1], color[0], 255])
      assert.equal(left[9 * 4 + 3], 0)
      assert.equal(right[3], 0)
      assert.equal(right[(10 * 10 - 1) * 4 + 3], 255)
    }
    for (const bounds of [
      { x: 30, y: 40, width: 500, height: 300 },
      { x: 50, y: 60, width: 600, height: 400 },
    ]) {
      page.layout(bounds, [255, 255, 255, 255], 10)
      page.setVisible(true)
      await page.contents.executeJavaScript(
        "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))))",
      )
      assert.deepEqual(page.view.getBounds(), bounds)
      assert.deepEqual(await page.contents.executeJavaScript("({width:innerWidth,height:innerHeight})"), {
        width: bounds.width,
        height: bounds.height,
      })
      assert.equal(win.contentView.children.length, children + 3)
      page.setVisible(false)
      assert(win.contentView.children.slice(children).every((view) => !view.getVisible()))
    }
    await execute({ type: "navigate", tabID, url })
    const frameURL = new URL("/frame", url.replace("127.0.0.1", "localhost")).href
    await execute({
      type: "evaluate",
      tabID,
      script: `new Promise(resolve => { const frame = document.querySelector('iframe'); frame.onload = () => resolve(null); frame.src = ${JSON.stringify(frameURL)}; })`,
    })
    const operation = Browser.Operations.find((op) => op.name === "frames")
    assert(operation)
    const listing = Schema.decodeUnknownSync(operation.output)((await execute({ type: "frames", tabID })).value)
    const frame = listing.frames.find((frame) => frame.url === frameURL)
    assert(frame)
    const frameID = frame.id
    const evaluation: Browser.Action = { type: "evaluate", tabID, frameID, script: "document.body.innerText" }
    assert.deepEqual((await inspect(evaluation)).resources, [frameURL])
    const snapshot = await execute({ type: "snapshot", tabID, frameID })
    const content = Schema.decodeUnknownSync(Schema.Struct({ content: Schema.String }))(snapshot.value).content
    const ref = content.match(/@e\d+/)?.[0]
    assert(ref)
    const click: Browser.Action = { type: "click", tabID, ref: Browser.Ref.make(ref) }
    const selected = await inspect(click)
    assert.deepEqual(selected.resources, [frameURL])
    await execute({
      type: "evaluate",
      tabID,
      script: `new Promise(resolve => { const frame = document.querySelector('iframe'); frame.onload = () => resolve(null); frame.src = ${JSON.stringify(url + "/frame")}; })`,
    })
    await assert.rejects(execute(click, selected), /target changed|Frame is unavailable|stale/)

    await execute({ type: "evaluate", tabID, script: "document.querySelector('a[href=\"/download\"]').click()" })
    const fileID = await waitForFile()
    assert.equal(page.state().loadError, undefined, "A download must not mark the page as unreachable")
    const fileAction: Browser.Action = { type: "files.get", tabID, fileID }
    const original = await inspect(fileAction)
    assert(original.resources.includes(url + "/download"))
    await execute({ type: "evaluate", tabID, script: "fetch('/api/test').then(response => response.json())" })
    const requests = Schema.decodeUnknownSync(
      Schema.Struct({ requests: Schema.Array(Schema.Struct({ id: Schema.String, url: Schema.String })) }),
    )((await execute({ type: "network.list", tabID })).value).requests
    const request = requests.find((request) => request.url.includes("/api/test"))
    assert(request)
    assert.deepEqual(await inspect({ type: "network.get", tabID, id: request.id, includeBody: true }), {
      resources: [request.url],
      key: request.id,
    })
    await execute({ type: "navigate", tabID, url: "about:blank" })
    assert.deepEqual(await inspect(fileAction), original)
    assert.equal(Buffer.from((await execute(fileAction, original)).files[0].data).toString(), "desktop download bytes")

    // The element picker names the exact node, here one inside a shadow root.
    await execute({ type: "navigate", tabID, url })
    await execute({
      type: "evaluate",
      tabID,
      script: `const host = document.createElement('x-card'); host.id = 'card'; host.style.cssText = 'position:fixed;top:0;left:0;display:block;background:white'; host.attachShadow({ mode: 'open' }).innerHTML = '<div>Title</div><div><button class="act">Shadow action</button></div>'; document.body.prepend(host); null`,
    })
    page.setVisible(true)
    await page.inspect(true)
    assert.deepEqual(inspections.at(-1), { active: true })
    const center = Schema.decodeUnknownSync(
      Schema.Struct({ value: Schema.Struct({ x: Schema.Finite, y: Schema.Finite }) }),
    )(
      (
        await execute({
          type: "evaluate",
          tabID,
          script:
            "(() => { const box = document.querySelector('#card').shadowRoot.querySelector('button').getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 } })()",
        })
      ).value,
    ).value
    const clickShadowButton = async () => {
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
        await page.contents.debugger.sendCommand("Input.dispatchMouseEvent", {
          type,
          ...center,
          button: "left",
          clickCount: 1,
        })
    }
    await clickShadowButton()
    const element = await until(() => inspections.find((event) => event.element)?.element)
    assert.equal(element.selector, "#card >>> div:nth-of-type(2) > button")
    assert.equal(element.label, "button.act")
    assert.equal(element.role, "button")
    assert.equal(element.name, "Shadow action")
    const onElement = async (script: string) =>
      Schema.decodeUnknownSync(Schema.Struct({ value: Schema.Unknown }))(
        (await execute({ type: "evaluate", tabID, ref: element.ref, script })).value,
      ).value
    assert.equal(await onElement("(element) => element.textContent"), "Shadow action")
    assert.equal(
      await onElement(
        `(element) => { const [host, inner] = ${JSON.stringify(element.selector)}.split(" >>> "); return document.querySelector(host).shadowRoot.querySelector(inner) === element }`,
      ),
      true,
      "Each selector segment resolves within its own root",
    )
    const pickedSnapshot = Schema.decodeUnknownSync(Schema.Struct({ content: Schema.String }))(
      (await execute({ type: "snapshot", tabID })).value,
    ).content
    assert(pickedSnapshot.includes(`@${element.ref} [button] "Shadow action"`), pickedSnapshot)
    assert.equal(await onElement("function () { return this.className }"), "act", "A snapshot keeps picked refs")
    assert.deepEqual(
      (await inspect({ type: "evaluate", tabID, ref: element.ref, script: "(element) => element.id" })).resources,
      [url + "/"],
    )
    await assert.rejects(onElement("document.title"), /needs a function that receives the element/)
    await assert.rejects(
      execute({ type: "evaluate", tabID, ref: element.ref, frameID: "main", script: "(element) => element.id" }),
      /not both/,
    )
    await page.inspect(true)
    await execute({ type: "hover", tabID, ref: element.ref })
    assert.deepEqual(inspections.at(-1), { active: false }, "Agent pointer input turns the picker off first")
    // Turning the picker off while it is still arming must leave the page unarmed.
    const arming = page.inspect(true)
    await page.inspect(false)
    await arming
    assert.deepEqual(inspections.at(-1), { active: false })
    await clickShadowButton()
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(inspections.filter((event) => event.element).length, 1, "An unarmed page does not pick")
    await page.inspect(true)
    page.setVisible(false)
    await until(() => inspections.at(-1)?.active === false)
    console.log("PASS native element picker targets a shadow DOM node by ref and selector")

    await execute({ type: "navigate", tabID, url })
    await assert.rejects(onElement("(element) => element.id"), /stale/)
    await execute({ type: "trace.start", tabID })
    await execute({ type: "navigate", tabID, url: "about:blank" })
    const traceTarget = await inspect({ type: "trace.stop", tabID })
    assert(traceTarget.resources.includes(url + "/"))
    assert(traceTarget.resources.includes("about:blank"))
    const trace = await execute({ type: "trace.stop", tabID }, traceTarget)
    const retained = await inspect({ type: "trace.analyze", tabID, fileID: trace.files[0].id })
    assert(retained.resources.includes(url + "/"))
  } finally {
    await page.dispose()
    assert.equal(win.contentView.children.length, children)
  }

  async function waitForFile() {
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      const value = (await execute({ type: "files.list", tabID })).value
      const files = Schema.decodeUnknownSync(
        Schema.Struct({ files: Schema.Array(Schema.Struct({ id: Browser.FileID, state: Schema.String })) }),
      )(value).files
      const file = files.find((file) => file.state === "completed")
      if (file) return file.id
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error("Download did not complete")
  }

  async function until<T>(check: () => T | undefined): Promise<T> {
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      const value = check()
      if (value) return value
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error("The page did not reach the expected state in time")
  }
}
