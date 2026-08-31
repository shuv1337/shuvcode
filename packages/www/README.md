# Shuvcode website

The Shuvcode V2 website and documentation, served under `/v2/`. The documentation implementation lives in `src/docs/`, and generated API data lives in `public/openapi.json`.

This repository does not own an automated WWW deployment. Build artifacts may be deployed separately only through an explicitly approved fork deployment process.

## Development

```bash
bun dev
```

## Verification

```bash
bun typecheck
bun run check:generated
bun run build
```
