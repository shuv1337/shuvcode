# shuvcode VS Code Extension

A Visual Studio Code extension that integrates [shuvcode](https://github.com/Latitudes-Dev/shuvcode) directly into your development workflow.

## Prerequisites

This extension requires the **shuvcode CLI** to be installed on your system and available on your `PATH`.

### Installing shuvcode

See the [shuvcode repository](https://github.com/Latitudes-Dev/shuvcode) for installation instructions.

> **Note:** This extension only works with `shuvcode`. It does not fall back to `opencode`.

## Features

- **Quick Launch**: Use `Cmd+Esc` (Mac) or `Ctrl+Esc` (Windows/Linux) to open shuvcode in a split terminal view, or focus an existing terminal session if one is already running.
- **New Session**: Use `Cmd+Shift+Esc` (Mac) or `Ctrl+Shift+Esc` (Windows/Linux) to start a new shuvcode terminal session, even if one is already open. You can also click the shuvcode button in the UI.
- **Context Awareness**: Automatically share your current selection or tab with shuvcode.
- **File Reference Shortcuts**: Use `Cmd+Option+K` (Mac) or `Alt+Ctrl+K` (Linux/Windows) to insert file references. For example, `@File#L37-42`.

## Breaking Changes from opencode

If you are migrating from the upstream `sst-dev.opencode` extension:

- **Extension ID**: Changed from `sst-dev.opencode` to `latitudes-dev.shuvcode`
- **Command IDs**: Changed from `opencode.*` to `shuvcode.*`
- **Environment Variables**: Changed from `OPENCODE_CALLER` to `SHUVCODE_CALLER`
- **CLI**: Only `shuvcode` is supported (no `opencode` fallback)

You will need to update any custom keybindings that reference the old command IDs.

## Support

If you encounter issues or have feedback, please create an issue at https://github.com/Latitudes-Dev/shuvcode/issues.

## Development

1. `code sdks/vscode` - Open the `sdks/vscode` directory in VS Code. **Do not open from repo root.**
2. `bun install` - Run inside the `sdks/vscode` directory.
3. Press `F5` to start debugging - This launches a new VS Code window with the extension loaded.

#### Making Changes

`tsc` and `esbuild` watchers run automatically during debugging (visible in the Terminal tab). Changes to the extension are automatically rebuilt in the background.

To test your changes:

1. In the debug VS Code window, press `Cmd+Shift+P`
2. Search for `Developer: Reload Window`
3. Reload to see your changes without restarting the debug session
