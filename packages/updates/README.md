# OpenCode Updates

The updates Worker serves all selected artifacts for a channel.

```sh
curl 'https://update.opencode.ai/api/latest'
curl 'https://update.opencode.ai/api/latest/cli'
curl 'https://update.opencode.ai/api/latest/cli/npm'
```

## Minimum releases

Each channel/name/distribution can mark one retained artifact as `minimum`, independently
of its `active` artifact. Set or clear it from the admin page. Publishing a new active
release preserves the minimum marker.

Clients send their running version as `?current=<version>`. Existing clients fall back
to `User-Agent: opencode/<version>`. A caller below the minimum receives that exact
artifact; callers at or above it receive the active artifact. An unparseable caller
version receives the minimum. Requests with neither version source receive the active
artifact. All three public API paths apply the same selection and use `Cache-Control:
no-store` because responses can depend on the User-Agent.

Version comparison uses semver, normalizing preview run numbers to numeric prerelease
identifiers and historical `next` versions to `beta`. The `/api/next` channel also
resolves to `beta`.

Choose a minimum that older clients can install and that can itself consume the active
release. For the CLI package migration, retain a package-aware release published as
`@opencode-ai/cli` as the minimum before activating releases under `@opencode/cli`.

The `/admin*` route must be protected by a Cloudflare Access self-hosted application. Configure the application with:

- Public hostname: `update.opencode.ai`
- Path: `admin*`
- Policy: allow the OpenCode team identity group

The Worker has `workers_dev` and preview URLs disabled so the custom hostname is its only public entry point.

## Request logging

Every request reaching the Worker emits an unsampled event at request start to the shared production
Cloudflare lake stream through the `EVENTS` Pipelines binding. Events use
`source: "update"`, `type: "request"`, an ISO `timestamp`, and a `payload` containing
the method, path, `useragent`, `ip` (from Cloudflare's `CF-Connecting-IP` header),
country, and Cloudflare colo. Query strings, request bodies, cookies, and authorization
headers are not included. Response status and duration are not recorded.

Delivery runs in `waitUntil` without delaying the response. Delivery failures are
logged but do not fail requests or retry; this is not lossless audit logging.
Requests blocked before reaching the Worker are not recorded.

The stream ID in `wrangler.jsonc` comes from the `lake.stream` output of the
`anomalyco/platform/production` Pulumi stack. Update the binding if that stream is
replaced. The stream is shared across release channels because the update service
has a single public deployment.

## Publishing

GitHub Actions publishes artifacts through `POST /api/publish` using a short-lived OIDC token with audience `https://update.opencode.ai`. The Worker accepts only tokens signed by GitHub for repository ID `975734319`, owner ID `66570915`, and `.github/workflows/publish.yml` on configured publishing refs.

Apply migrations and deploy from this directory:

```sh
bun run db:migrate
bun run deploy
```
