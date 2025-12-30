# Shuvcode Desktop (Tauri)

This package bundles the Shuvcode desktop app and ships the CLI sidecar.

## Development

1. Build the sidecar CLI for your target:
   `bun run predev`
2. Start the desktop app:
   `bun run tauri dev`

## Build

1. Ensure the sidecar is present:
   `bun run predev`
2. Build the Tauri bundles:
   `bun run tauri build`

## Recommended IDE Setup

- VS Code + Tauri + rust-analyzer
