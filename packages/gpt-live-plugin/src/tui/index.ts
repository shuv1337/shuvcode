import { Plugin } from "@opencode/plugin/tui"

import { VOICES, type Voice } from "../shared/rpc"
import { VoiceController } from "./controller"
import { Frames, footerBadge, transcriptPanel, voiceAura, voiceStrip, type View } from "./ui"

const PANEL = "gptlive.transcript"

/** Resolves once `ready()` returns true, or after `timeout` milliseconds, whichever comes first. */
function waitFor(ready: () => unknown, timeout: number, interval = 25) {
  return new Promise<void>((resolve) => {
    const started = Date.now()
    const timer = setInterval(() => {
      if (!ready() && Date.now() - started < timeout) return
      clearInterval(timer)
      resolve()
    }, interval)
  })
}

/**
 * The host re-runs slot renders whenever their input object changes (for the panel, on every
 * prompt edit) without destroying what the previous render returned. Views hold renderer
 * listeners and animation state, so each slot keeps one view per key (the session) and reads
 * the latest input through an accessor. Views left detached by a new key are destroyed.
 */
function persistent<I>(frames: Frames, key: (input: I) => string, create: (input: () => I) => View) {
  const inputs = new Map<string, I>()
  const views = new Map<string, View>()
  return (next: I) => {
    const id = key(next)
    inputs.set(id, next)
    const existing = views.get(id)
    if (existing && !existing.root.isDestroyed) return frames.mount(existing)
    for (const [other, view] of views)
      if (!view.root.parent || view.root.isDestroyed) {
        views.delete(other)
        inputs.delete(other)
        if (!view.root.isDestroyed) view.root.destroyRecursively()
      }
    const view = create(() => inputs.get(id) ?? next)
    views.set(id, view)
    return frames.mount(view)
  }
}

// Keys come from the TUI keybind table (voice.*), so they are configured like any other command.
export default Plugin.define({
  id: "shuvcode.gpt-live",
  setup(context) {
    const options = context.options as {
      voice?: string
      panel?: boolean
      duck?: boolean
    }
    const voice = new VoiceController(context, {
      voice: VOICES.includes(options.voice as Voice) ? (options.voice as Voice) : undefined,
      // Other apps' audio is turned down during calls and restored afterwards.
      duck: options.duck !== false,
    })
    const frames = new Frames(voice)
    const autoPanel = options.panel !== false

    const currentSession = () => {
      const route = context.ui.router.current()
      return route.type === "session" ? route.sessionID : undefined
    }

    // With no session open (e.g. on the home screen), a call starts in a new session.
    const openNewSession = async () => {
      try {
        const location = context.location ?? context.data.location.default()
        const created = await context.client.session.create({ location })
        const previous = context.renderer.currentFocusedEditor
        context.ui.router.navigate({ type: "session", sessionID: created.id })
        // Wait for the new session's prompt to mount and take focus, so opening the panel
        // hands focus back to it rather than to the home screen's (now gone) prompt.
        const ready = () => {
          const editor = context.renderer.currentFocusedEditor
          return currentSession() === created.id && editor && editor !== previous && !editor.isDestroyed
        }
        await waitFor(ready, 2_000)
        return created.id
      } catch (error) {
        context.ui.toast.show({
          title: "GPT-Live",
          message: `Could not start a new session: ${error instanceof Error ? error.message : String(error)}`,
          variant: "error",
        })
        return undefined
      }
    }

    const start = async (chosen?: Voice, fresh = false) => {
      const sessionID = currentSession() ?? (await openNewSession())
      if (!sessionID) return
      if (autoPanel) openPanelKeepingFocus()
      await voice.start(sessionID, chosen, fresh)
    }

    // Close the transcript panel when a call ends normally; keep it open after a failure
    // so the error stays readable.
    let wasActive = false
    const stopWatchingCall = voice.onChange(() => {
      const active = voice.active
      if (wasActive && !active && voice.state.phase === "idle" && context.ui.panel.current()?.name === PANEL)
        context.ui.panel.close()
      wasActive = active
    })

    // Opening a panel moves keyboard focus into it; hand focus back so typing still goes
    // to the prompt during a call.
    const openPanelKeepingFocus = () => {
      const focused = context.renderer.currentFocusedEditor ?? context.renderer.currentFocusedRenderable
      const opened = context.ui.panel.open(PANEL)
      if (opened && focused && !focused.isDestroyed) {
        setTimeout(() => {
          if (!focused.isDestroyed) context.renderer.focusRenderable(focused)
        }, 0)
      }
      return opened
    }

    const toggle = () => (voice.active ? voice.stop() : start())

    const restartWith = async (name: Voice, fresh = false) => {
      if (voice.active) await voice.stop()
      await start(name, fresh)
    }

    const pickVoice = async () => {
      const chosen = await context.ui.dialog.select<Voice>({
        title: "GPT-Live voice",
        current: (voice.state.voice as Voice | undefined) ?? (options.voice as Voice | undefined) ?? "cove",
        options: VOICES.map((name) => ({ title: name, value: name })),
      })
      if (chosen) await restartWith(chosen)
    }

    const togglePanel = () => {
      if (context.ui.panel.current()?.name === PANEL) context.ui.panel.close()
      else if (!openPanelKeepingFocus())
        context.ui.toast.show({
          title: "GPT-Live",
          message: "Open a session to see the voice transcript.",
          variant: "info",
        })
    }

    const disposers = [
      context.ui.slot({
        append: "app",
        render: () => {
          context.keymap.layer(() => ({
            mode: "global",
            commands: [
              {
                id: "voice.toggle",
                title: "Voice call: start or end (GPT-Live)",
                description: "Talk to OpenCode with GPT-Live using your ChatGPT subscription",
                group: "Voice",
                palette: true,
                suggested: true,
                slash: { name: "voice" },
                run: () => toggle(),
              },
              {
                id: "voice.stop",
                title: "Voice call: end",
                group: "Voice",
                palette: true,
                slash: { name: "voice-stop", aliases: ["hangup"] },
                run: () => voice.stop(),
              },
              {
                id: "voice.new",
                title: "Voice call: start with a fresh voice session",
                description: "Forget earlier calls for this session and start over",
                group: "Voice",
                palette: true,
                slash: { name: "voice-new" },
                run: () =>
                  restartWith((voice.state.voice as Voice | undefined) ?? (options.voice as Voice) ?? "cove", true),
              },
              {
                id: "voice.mute",
                title: "Voice call: mute or unmute microphone",
                group: "Voice",
                palette: true,
                slash: { name: "voice-mute" },
                enabled: () => voice.active,
                run: () => voice.toggleMute(),
              },
              {
                id: "voice.panel",
                title: "Voice call: toggle transcript",
                group: "Voice",
                palette: true,
                slash: { name: "voice-panel" },
                enabled: () => voice.active || context.ui.panel.current()?.name === PANEL,
                run: () => togglePanel(),
              },
              {
                id: "voice.pick",
                title: "Voice call: choose voice",
                group: "Voice",
                palette: true,
                slash: { name: "voice-pick" },
                run: () => pickVoice(),
              },
            ],
          }))
          return null
        },
      }),
      context.ui.slot({
        append: "session.composer.top",
        render: persistent(
          frames,
          (input) => input.sessionID,
          (input: () => { sessionID: string }) => voiceStrip(context, voice, () => input().sessionID),
        ),
      }),
      context.ui.slot({
        append: "session.panel",
        render: persistent(
          frames,
          (panel) => panel.sessionID,
          (panel: () => { name: string; sessionID: string }) => {
            const open = () => panel().name === PANEL
            const view = transcriptPanel(context, voice, () => open() && voice.owns(panel().sessionID))
            return {
              root: view.root,
              animating: (now) => open() && view.animating(now),
              interval: view.interval,
              suspend: view.suspend,
              dispose: view.dispose,
              update(now) {
                const show = open()
                if (view.root.visible !== show) view.root.visible = show
                if (show) view.update(now)
                else view.suspend?.()
              },
            }
          },
        ),
      }),
      context.ui.slot({
        prepend: "sidebar.content",
        render: persistent(
          frames,
          (input) => input.sessionID,
          (input: () => { sessionID: string }) =>
            voiceAura(context, voice, () => voice.owns(input().sessionID), "gptlive-aura-sidebar"),
        ),
      }),
      context.ui.slot({
        append: "prompt.footer.status",
        render: persistent(
          frames,
          () => "footer",
          () => footerBadge(context, voice),
        ),
      }),
      context.ui.slot({
        append: "home.footer.status",
        render: persistent(
          frames,
          () => "footer",
          () => footerBadge(context, voice),
        ),
      }),
    ]

    // Developer switch for unattended UI tests: start a call once a session is open.
    let autostart: ReturnType<typeof setInterval> | undefined
    if (process.env.GPT_LIVE_AUTOSTART) {
      autostart = setInterval(() => {
        if (!currentSession()) return
        clearInterval(autostart)
        autostart = undefined
        void start()
      }, 500)
    }

    return async () => {
      if (autostart) clearInterval(autostart)
      stopWatchingCall()
      for (const dispose of disposers) dispose()
      await voice.dispose()
      frames.dispose()
    }
  },
})
