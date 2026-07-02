export const SPINNERS: Record<string, string[]> = {
  WIDE_SCAN: ["▐ ", "▊ ", "▉ ", "█ ", " █", " ▉", " ▊", " ▐"],
  KITT_SCANNER: ["▌ ", " ▌", " ▐", "▐ "],
  LOW_BOUNCE: ["▖ ", " ▖", " ▖", " ▗", " ▗", "▗ "],
  LOW_KITT: ["▖ ", " ▖", " ▗", "▗ "],
  HIGH_KITT: ["▘ ", " ▘", " ▝", "▝ "],
  DOUBLE_PULSE: ["░░", "▒▒", "▓▓", "██", "▓▓", "▒▒"],
  CURTAINS: ["▐▌", "▊▋", "▉▍", "█▎", "▉▍", "▊▋", "▐▌"],
  RUBIKS_TWIST: ["▙▛", "▚▞", "▟▜", "▞▚"],
  DNA_HELIX: ["▚▞", "▞▚"],
  BINARY_COUNT: ["00", "01", "10", "11"],
  SIGNAL_BARS: ["  ", "▂ ", "▂▃", "▄▅", "▆▇", "█▇", "▅▄", "▃▂", " "],
  EYES_BLINK: ["●●", "○○", "◡◡", "○○", "●●", "●●", "●●"],
  PAC_CHASE: ["ᗧ ", "ᗧ•", "ᗤ•", "ᗧ•"],
  WAVE_FLOW: [" ▂", "▃▄", "▅▆", "▇█", "▆▅", "▄▃", "▂ "],
  ARROWS_PASS: ["▹▹", "▸▹", "▸▸", "▹▸", "▹▹"],
  BRACKET_BREATHE: ["[]", "[ ]", "[  ]", "[   ]", "[  ]", "[ ]"],
  ZIPPERS: ["▖▗", "▝▘", "▚▞"],
  WIDE_ORBIT_CW: ["⠁ ", "⠈ ", " ⠁", " ⠈", " ⠂", " ⠄", "⠄ ", "⠂ "],
  WIDE_BLOCK_TUMBLE: ["▖ ", "▘ ", "▝ ", " ▘", " ▝", " ▗", " ▖", "▗ "],
  SQUISH_SPIN: ["▙▜", "▚▚", "▟▛", "▞▞"],
  DIGITAL_8: [" ▙", " ▛", " ▜", " ▟", "▙ ", "▛ ", "▜ ", "▟ "],
  FLIP_3D: ["▖▗", "▅▅", "▘▝", "▀▀"],
  OFF_AXIS: ["▃ ", " ▍", " ▀", "▋ ", "▃ "],
  BLADE_SPIN: ["◵ ", " ◵", " ◴", "◴ "],
  WIDE_CLOCK: ["🕐🕑", "🕒🕓", "🕔🕕", "🕖🕗", "🕘🕙", "🕚🕛"],
  DANCING_SQUARES: ["▖▖", "▘▘", "▝▝", "▗▗"],
  DUAL_DOTS_SPIN: ["⠋⠋", "⠙⠙", "⠹⠹", "⠸⠸", "⠼⠼", "⠴⠴", "⠦⠦", "⠧⠧", "⠇⠇", "⠏⠏"],
  BRAILLE_RIPPLE_WIDE: ["⣀⣀", "⣤⣤", "⣶⣶", "⣿⣿", "⣶⣶", "⣤⣤", "⣀⣀"],
  SHADE_PULSE: ["░", "▒", "▓", "█", "▓", "▒"],
  VERT_FILL: [" ", "▂", "▃", "▄", "▅", "▆", "▇", "█", "▇", "▆", "▅", "▄", "▃", "▂"],
  ARC: ["◜", "◝", "◞", "◟"],
  CIRCLE_QUARTERS: ["◴", "◷", "◶", "◵"],
  DOTS: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  BRAILLE_SPIN: ["⠋", "⠙", "⠚", "⠞", "⠖", "⠦", "⠴", "⠲", "⠳", "⠓"],
  LINE: ["-", "\\", "|", "/"],
  ARROW_SPIN: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"],
  STAR_TWINKLE: ["✶", "✸", "✹", "✺", "✹", "✸"],
  MOON_PHASE: ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"],
  CLOCK_SWEEP: ["🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘", "🕙", "🕚", "🕛"],
  PULSE_TEXT: ["o", "O", "0", "O", "o", "."],
}

export const DEFAULT_SPINNER_KEY = "DOTS"
export const DEFAULT_SPINNER_INTERVAL_MS = 60
export const MIN_SPINNER_INTERVAL_MS = 20
export const MAX_SPINNER_INTERVAL_MS = 500

export const SPINNER_INTERVAL_PRESETS = [
  { label: "Fastest (20ms)", value: 20 },
  { label: "Fast (40ms)", value: 40 },
  { label: "Default (60ms)", value: 60 },
  { label: "Moderate (80ms)", value: 80 },
  { label: "Slow (120ms)", value: 120 },
  { label: "Slower (200ms)", value: 200 },
  { label: "Slowest (500ms)", value: 500 },
] as const

export function getSpinnerKeys() {
  return Object.keys(SPINNERS).sort()
}

export function getSpinnerDisplayName(key: string) {
  return key
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

export function getSpinnerPreview(key: string) {
  const frames = SPINNERS[key]
  if (!frames) return ""
  return frames.slice(0, 3).join(" ")
}

export function spinnerFrames(key: string) {
  return SPINNERS[key] ?? SPINNERS[DEFAULT_SPINNER_KEY]
}

export function clampInterval(ms: number) {
  return Math.max(MIN_SPINNER_INTERVAL_MS, Math.min(MAX_SPINNER_INTERVAL_MS, ms))
}