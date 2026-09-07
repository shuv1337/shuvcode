# Public Files

Each stack owns one R2 bucket, a Worker, and a `/files/*` route on its domain.
Production resources are Pulumi-protected.

| Stack       | Bucket and Worker           | Public URL                       |
| ----------- | --------------------------- | -------------------------------- |
| Development | `opencode-dev-files`        | `https://dev.opencode.ai/files/` |
| Production  | `opencode-production-files` | `https://opencode.ai/files/`     |

The Worker removes `/files/` and URL-decodes the remaining path to obtain the R2
object key. For example:

```text
R2 key: releases/1.0.0/opencode-linux-x64.tar.gz
URL:    https://opencode.ai/files/releases/1.0.0/opencode-linux-x64.tar.gz

R2 key: videos/demo.mp4
URL:    https://opencode.ai/files/videos/demo.mp4
```

## Deployment

This directory is the standalone `anomalyco/files` Pulumi project. Pulumi manages
the bucket, Worker source, R2 binding, and zone route. The preview and deploy
scripts bundle the Worker with Bun first; Wrangler is unnecessary.
The route uses the stage's existing proxied DNS record
and takes precedence over broader website routes. Production uses `opencode.ai`;
development uses `dev.opencode.ai`, and personal stages use `<stage>.dev.opencode.ai`.

```bash
bun typecheck
bun run preview --stack anomalyco/files/dev
bun run deploy --stack anomalyco/files/dev
bun run preview --stack anomalyco/files/production
bun run deploy --stack anomalyco/files/production
```

The stack exports `bucketName` and `url`. The Cloudflare credential
comes from the stack's imported Pulumi ESC environment and needs R2, Workers
Scripts, and Workers Routes write permissions, plus zone read access.

Initialize new stacks once with `bunx pulumi stack init anomalyco/files/<stage>`.
The checked-in development and production stack files import `shared/dev` and
`shared/production` respectively. Personal stages need an ESC import providing
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`, and a proxied stage hostname.

`.github/workflows/deploy-files.yml` deploys development on every push to `dev`
and production on every push to `v2`. It uses the same Pulumi Cloud OIDC login as
the platform workflow; Cloudflare credentials are supplied through ESC.

The `anomalyco` Pulumi organization's GitHub OIDC issuer must allow organization
tokens with audience `urn:pulumi:org:anomalyco` and these subjects:

- `repo:anomalyco/opencode:ref:refs/heads/dev`
- `repo:anomalyco/opencode:ref:refs/heads/v2`

## Uploading

Upload through the R2 dashboard or its S3-compatible API using bucket-scoped
credentials. Store objects without a `files/` prefix. The public Worker accepts
only `GET`, `HEAD`, and CORS `OPTIONS`; upload access remains with authenticated
R2 clients. There is no bucket listing or directory index.

Set HTTP metadata when uploading:

- `Content-Type`: the actual media type, such as `video/mp4`, `image/png`, or
  `application/gzip`. Missing types default to `application/octet-stream`.
- `Content-Disposition`: use `attachment; filename="..."` when a file should
  download rather than display inline.
- `Cache-Control`: defaults to `public, max-age=3600` (one hour). Use
  `public, max-age=31536000, immutable` for versioned/content-addressed files,
  and a short TTL or `no-store` for mutable pointers such as `latest.json`.

The Worker preserves the object's HTTP metadata, returns ETag and Last-Modified
validators, supports conditional GET/HEAD, and streams single byte ranges for
video seeking and download resumption, including If-Range. Unsupported or
malformed range formats fall back to a full response. Public CORS allows these
files to be consumed from other origins.

## Caching

Complete GET responses up to 512 MiB are cached through the Workers Cache API
at the serving Cloudflare location, subject to object Cache-Control. Cached
complete objects can also satisfy range requests. Cold range requests stream
only the requested bytes from R2 and do not populate the cache. Larger objects
stream from R2. This cache does not use Tiered Cache.

Query strings are retained in cache keys but do not change the R2 key. Cookies
and authorization do not affect public file contents. Replacing/deleting an R2
object does not purge an already-cached response: use versioned keys, wait for
the TTL, or purge the public URL through Cloudflare. Request `Cache-Control:
no-cache` bypasses the cache for revalidation.

## Verification

After uploading an object, check its full response, metadata, and byte ranges:

```bash
curl -I https://opencode.ai/files/videos/demo.mp4
curl --fail -H 'Range: bytes=0-31' -D - \
  https://opencode.ai/files/videos/demo.mp4 -o /dev/null
```

Expect `200` for HEAD and `206` with `Content-Range` for the range request. A
missing key returns `404`, unsupported methods return `405`, and matching
If-None-Match/If-Modified-Since requests return `304`.
