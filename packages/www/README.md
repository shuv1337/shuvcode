# Shuvcode website

The Shuvcode V2 website, powered by Blume and deployed with Wrangler at `https://shuv.ai/v2/`. Blume mounts the documentation at `/v2/docs`.

Wrangler deploys the site through Blume's Cloudflare server adapter. Documentation pages are prerendered, while custom dynamic routes and endpoints can run in the Worker. Production uses `shuvcode-www-production` at `shuv.ai/v2/`; dev uses `shuvcode-www-dev` at `dev.shuv.ai/v2/`.

The `deploy-www` GitHub workflow deploys the `dev` branch to the dev Worker and the `v2` branch to the production Worker.

## Development

From this directory, run:

```bash
bun dev
```

The site opens at `http://localhost:3000/v2/`; documentation is available at `http://localhost:3000/v2/docs`.

## Verification

```bash
bun typecheck
bun validate
bun run build
```
