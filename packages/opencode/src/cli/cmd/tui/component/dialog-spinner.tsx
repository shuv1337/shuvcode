import { DialogSelect, type DialogSelectRef } from "../ui/dialog-select"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import {
  SPINNERS,
  getSpinnerKeys,
  getSpinnerDisplayName,
  getSpinnerStyle,
  setSpinnerStyle,
  DEFAULT_SPINNER_KEY,
  SPINNER_INTERVAL_MS,
} from "../util/spinners"
import { useKV } from "../context/kv"

export function DialogSpinnerList() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const kv = useKV()
  let ref: DialogSelectRef<string>
  const initial = getSpinnerStyle()

  // Create a signal for the preview animation
  const [previewIndex, setPreviewIndex] = createSignal(0)
  const [selectedKey, setSelectedKey] = createSignal(initial)

  // Animate preview
  createEffect(() => {
    const interval = setInterval(() => {
      const frames = SPINNERS[selectedKey()] || SPINNERS[DEFAULT_SPINNER_KEY]
      setPreviewIndex((prev) => (prev + 1) % frames.length)
    }, SPINNER_INTERVAL_MS)
    onCleanup(() => clearInterval(interval))
  })

  // Reset preview index when selection changes
  createEffect(
    on(selectedKey, () => {
      setPreviewIndex(0)
    }),
  )

  const currentFrame = createMemo(() => {
    const frames = SPINNERS[selectedKey()] || SPINNERS[DEFAULT_SPINNER_KEY]
    return frames[previewIndex()]
  })

  const options = getSpinnerKeys().map((key) => ({
    title: getSpinnerDisplayName(key),
    value: key,
    description: SPINNERS[key].slice(0, 3).join(" "),
  }))

  return (
    <>
      <box paddingLeft={4} paddingRight={4} paddingBottom={1}>
        <text fg={theme.textMuted}>
          Preview: <span style={{ fg: theme.primary, bold: true }}>{currentFrame()}</span>
        </text>
      </box>
      <DialogSelect
        title="Spinner Style"
        placeholder="Search spinners..."
        options={options}
        current={initial}
        onMove={(opt) => {
          setSelectedKey(opt.value)
        }}
        onSelect={(opt) => {
          setSpinnerStyle(opt.value)
          kv.set("spinner_style", opt.value)
          dialog.clear()
        }}
        ref={(r) => {
          ref = r
        }}
        onFilter={(query) => {
          if (query.length === 0) {
            setSelectedKey(initial)
            return
          }
          const first = ref.filtered[0]
          if (first) setSelectedKey(first.value)
        }}
      />
    </>
  )
}
