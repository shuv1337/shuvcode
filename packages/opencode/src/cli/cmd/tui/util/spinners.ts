import { createSignal } from "solid-js"

/**
 * Collection of spinner styles for the TUI.
 * Each spinner is an array of frames that cycle during animation.
 */
export const SPINNERS: Record<string, string[]> = {
  // --- WIDE / MULTI-CELL (2+ Blocks) ---
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

  // --- WIDE SPINNING (Simulated Rotation) ---
  WIDE_ORBIT_CW: ["⠁ ", "⠈ ", " ⠁", " ⠈", " ⠂", " ⠄", "⠄ ", "⠂ "],
  WIDE_BLOCK_TUMBLE: ["▖ ", "▘ ", "▝ ", " ▘", " ▝", " ▗", " ▖", "▗ "],
  SQUISH_SPIN: ["▙▜", "▚▚", "▟▛", "▞▞"],
  DIGITAL_8: [" ▙", " ▛", " ▜", " ▟", "▙ ", "▛ ", "▜ ", "▟ "],
  FLIP_3D: ["▖▗", "▅▅", "▘▝", "▀▀"],
  OFF_AXIS: ["▃ ", " ▍", " ▀", "▋ ", "▃ "],
  BLADE_SPIN: ["◵ ", " ◵", " ◴", "◴ "],
  WIDE_CLOCK: ["🕐🕑", "🕒🕓", "🕔🕕", "🕖🕗", "🕘🕙", "🕚🕛"],
  DANCING_SQUARES: ["▖▖", "▘▘", "▝▝", "▗▗"],

  // --- WIDE BRAILLE ---
  DUAL_DOTS_SPIN: ["⠋⠋", "⠙⠙", "⠹⠹", "⠸⠸", "⠼⠼", "⠴⠴", "⠦⠦", "⠧⠧", "⠇⠇", "⠏⠏"],
  BRAILLE_RIPPLE_WIDE: ["⣀⣀", "⣤⣤", "⣶⣶", "⣿⣿", "⣶⣶", "⣤⣤", "⣀⣀"],
  BRAILLE_SNAKE_WIDE: ["⠁⠀", "⠂⠀", "⠄⠀", "⡀⠀", "⠀⡀", "⠀⠄", "⠀⠂", "⠀⠁", "⠀⠈", "⠀⠐", "⠀⠠", "⠀⢀", "⢀⠀", "⠠⠀", "⠐⠀", "⠈⠀"],
  MATRIX_RAIN: ["⡀⠀", "⡄⠀", "⡆⠀", "⡇⠀", "⣇⠀", "⣧⠀", "⣷⠀", "⣿⠀", "⣿⡀", "⣿⡄", "⣿⡆", "⣿⡇", "⣿⣇", "⣿⣧", "⣿⣷", "⣿⣿"],
  MICRO_SCAN: ["⠂⠀", "⠆⠀", "⠇⠀", "⠏⠀", "⠟⠀", "⠿⠀", "⡿⠀", "⣿⠀", "⣿⠂", "⣿⠆", "⣿⠇", "⣿⠏", "⣿⠟", "⣿⠿", "⣿⡿", "⣿⣿"],
  BRAILLE_EQUALIZER: ["⣀⠀", "⣤⠀", "⣶⠀", "⣿⠀", "⣿⣀", "⣿⣤", "⣿⣶", "⣿⣿", "⣶⣿", "⣤⣿", "⣀⣿", "⠀⣿", "⠀⣶", "⠀⣤", "⠀⣀", "⠀⠀"],
  PIXEL_MORPH: ["⠁⠁", "⠃⠃", "⠇⠇", "⠏⠏", "⠟⠟", "⠿⠿", "⡿⡿", "⣿⣿", "⡿⡿", "⠿⠿", "⠟⠟", "⠏⠏", "⠇⠇", "⠃⠃", "⠁⠁"],
  BINARY_NOISE: ["⠁⠂", "⠂⠁", "⠄⠠", "⠠⠄", "⡀⢀", "⢀⡀", "⠐⠈", "⠈⠐"],

  // --- HIGH FIDELITY BLOCKS ---
  SHADE_PULSE: ["░", "▒", "▓", "█", "▓", "▒"],
  VERT_FILL: [" ", "▂", "▃", "▄", "▅", "▆", "▇", "█", "▇", "▆", "▅", "▄", "▃", "▂"],
  HORIZ_FILL: ["▏", "▎", "▍", "▌", "▋", "▊", "▉", "█", "▉", "▊", "▋", "▌", "▍", "▎", "▏"],
  QUAD_GROW: ["▖", "▞", "▟", "█", "▟", "▞", "▖"],
  QUAD_SPIN: ["▖", "▘", "▝", "▗"],
  HALF_SPIN: ["▌", "▀", "▐", "▄"],
  TETRIS: ["▙", "▛", "▜", "▟"],
  RETRO_NOISE: ["▚", "▞"],
  INVERT: ["█", " "],

  // --- GEOMETRIC SHAPES ---
  ARC: ["◜", "◝", "◞", "◟"],
  CIRCLE_QUARTERS: ["◴", "◷", "◶", "◵"],
  SQUARE_CORNERS: ["◰", "◳", "◲", "◱"],
  TRIANGLE_DANCE: ["◢", "◣", "◤", "◥"],
  DIAMOND_BREATHE: ["◇", "◈", "◆", "◈"],
  TARGET: ["◎", "◉", "●", "◉"],

  // --- BRAILLE ART ---
  DOTS: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  BRAILLE_FILL: ["⣀", "⣤", "⣶", "⣿", "⣶", "⣤", "⣀"],
  BRAILLE_SPIN: ["⠋", "⠙", "⠚", "⠞", "⠖", "⠦", "⠴", "⠲", "⠳", "⠓"],
  WATER: ["⠀", "⠄", "⠆", "⠇", "⠋", "⠙", "⠸", "⠰", "⠠", "⠀"],
  SNAKE: ["⠐", "⠠", "⢀", "⡀", "⠄", "⠂", "⠁", "⠈"],

  // --- CLASSIC CLI ---
  LINE: ["-", "\\", "|", "/"],
  ARROW_SPIN: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"],
  PIPE_FLIP: ["┤", "┘", "┴", "└", "├", "┌", "┬", "┐"],
  STAR_TWINKLE: ["✶", "✸", "✹", "✺", "✹", "✸"],

  // --- CREATIVE CONCEPTS ---
  MOON_PHASE: ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"],
  CLOCK_SWEEP: ["🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘", "🕙", "🕚", "🕛"],
  EQ_RHYTHM: ["▅", "▇", "█", "▇", "▅", "▃", " ", "▃"],
  WIFI_FADE: [" ", "·", "•", "●", "•", "·"],
  BOUNCE_BALL: [
    "( ●    )",
    "(  ●   )",
    "(   ●  )",
    "(    ● )",
    "(     ●)",
    "(    ● )",
    "(   ●  )",
    "(  ●   )",
    "( ●    )",
  ],
  FISH: [">))'>", " >))'>", "  >))'>", "   >))'>", "    >))'>", "   <'((<", "  <'((<", " <'((<"],
  BATTERY_CHARGE: ["🪫 ", "🔋"],
  HEART_BEAT: ["❤️ ", "🤍"],
  DICE_ROLL: ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"],
  WEATHER_CYCLE: ["☀️ ", "🌤️ ", "⛅", "☁️ ", "🌦️ ", "🌧️ ", "🌩️ ", "❄️ "],
  DOMINOES: ["🀰", "🀱", "🀲", "🀳", "🀴", "🀵"],
  MAHJONG_WINDS: ["🀀", "🀁", "🀂", "🀃"],

  // --- TEXT BASED ---
  KAOMOJI_SQUINT: ["(   )", "(-  )", "(-- )", "(---)", "(-- )", "(-  )"],
  PULSE_TEXT: ["o", "O", "0", "O", "o", "."],
}

/** Default spinner key */
export const DEFAULT_SPINNER_KEY = "DUAL_DOTS_SPIN"

/** Spinner interval in milliseconds */
export const SPINNER_INTERVAL_MS = 60

/**
 * Get all available spinner keys sorted alphabetically
 */
export function getSpinnerKeys(): string[] {
  return Object.keys(SPINNERS).sort()
}

/**
 * Get a display name for a spinner key (title case with underscores replaced by spaces)
 */
export function getSpinnerDisplayName(key: string): string {
  return key
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

/**
 * Get preview frames for a spinner (first 3 frames joined)
 */
export function getSpinnerPreview(key: string): string {
  const frames = SPINNERS[key]
  if (!frames) return ""
  return frames.slice(0, 3).join(" ")
}

// Module-level shared spinner state
let spinnerInitialized = false
let currentSpinnerKey = DEFAULT_SPINNER_KEY
const [spinnerIndex, setSpinnerIndex] = createSignal(0)

/**
 * Initialize the spinner interval (called once on first use)
 */
function initSpinner() {
  if (spinnerInitialized) return
  spinnerInitialized = true
  setInterval(() => {
    const frames = SPINNERS[currentSpinnerKey] || SPINNERS[DEFAULT_SPINNER_KEY]
    setSpinnerIndex((prev) => (prev + 1) % frames.length)
  }, SPINNER_INTERVAL_MS)
}

/**
 * Set the current spinner style
 */
export function setSpinnerStyle(key: string) {
  if (SPINNERS[key]) {
    currentSpinnerKey = key
    setSpinnerIndex(0)
  }
}

/**
 * Get the current spinner style key
 */
export function getSpinnerStyle(): string {
  return currentSpinnerKey
}

/**
 * Get the current spinner frame (reactive)
 */
export function getSpinnerFrame(): string {
  initSpinner()
  const frames = SPINNERS[currentSpinnerKey] || SPINNERS[DEFAULT_SPINNER_KEY]
  return frames[spinnerIndex()]
}
