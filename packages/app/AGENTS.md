# Agent Guidelines for @opencode/app

## Build/Test Commands

- **Development**: `bun run dev` (starts Vite dev server on port 3000)
- **Build**: `bun run build` (production build)
- **Preview**: `bun run serve` (preview production build)
- **Validation**: Use `bun run typecheck` only - do not build or run project for validation
- **Testing**: Do not create or run automated tests

## Running Desktop in Development

To run the desktop app in development mode, you need **two terminals**:

1. **Terminal 1 - API Server** (from repo root):

   ```bash
   bun run dev serve --port 4096
   ```

2. **Terminal 2 - Desktop App** (from packages/desktop):
   ```bash
   bun run dev
   ```

The desktop dev server runs at http://localhost:3000 and connects to the API at port 4096.

**Note**: The `--port 4096` flag is required because the server defaults to a random port (for multi-instance support in Tauri). The `.env.development` file sets `VITE_OPENCODE_SERVER_PORT=4096` so the desktop app knows where to connect.

## Code Style

- **Framework**: SolidJS with TypeScript
- **Imports**: Use `@/` alias for src/ directory (e.g., `import Button from "@/ui/button"`)
- **Formatting**: Prettier configured with semicolons disabled, 120 character line width
- **Components**: Use function declarations, splitProps for component props
- **Types**: Define interfaces for component props, avoid `any` type
- **CSS**: TailwindCSS with custom CSS variables theme system
- **Naming**: PascalCase for components, camelCase for variables/functions, snake_case for file names
- **File Structure**: UI primitives in `/ui/`, higher-level components in `/components/`, pages in `/pages/`, providers in `/providers/`

## Key Dependencies

- SolidJS, @solidjs/router, @kobalte/core (UI primitives)
- TailwindCSS 4.x with @tailwindcss/vite
- Custom theme system with CSS variables

No special rules files found.
