# Plan: Mobile-to-Server QR Pairing

| Field  | Value                                                               |
| ------ | ------------------------------------------------------------------- |
| Status | Reviewed against the post-M3 repositories; ready for implementation |
| Date   | 2026-07-14                                                          |
| Scope  | Shuvcode V2, shuvkit, OpenShuv, and coordinated ClankerOne changes  |

## Goal

Let an operator pair a mobile client with a Shuvcode V2 server by scanning a QR code without transferring the server's long-lived administrator password.

Pairing must enroll a unique, persistent, revocable credential for each mobile device. A photographed or replayed invitation must stop working after its first successful redemption or a short expiration period.

## Current State

Upstream V2 already implements connection sharing in the CLI and TUI:

- `shuvcode pair` starts or discovers the managed service.
- The client calls authenticated `GET /api/server` to discover usable URLs.
- The CLI and TUI render `{ urls, username, password }` as a QR code.
- The password is the managed server's persistent shared Basic-auth password.

This is enough to prototype QR scanning, but it is not device pairing. Anyone who obtains the QR receives full access until the shared password is rotated. Rotation invalidates every client at once, and the server cannot identify or revoke one device.

The V2 PTY connect-ticket implementation provides a useful precedent for short-lived, process-local, atomically consumed tokens. Pairing invitations can follow that pattern, but enrolled device credentials must be durable.

The reviewed implementation baseline is now:

| Project    | Current baseline                                                                       | Pairing-relevant state                                                                                                                                                                           |
| ---------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shuvcode   | `integration-v2` after PR #334 (`dc1fb66264`; attachment contract commit `8f7b0d8dc3`) | Basic-only global authorization; `/api/server` returns runtime connection URLs; no pairing domain or authenticated principal                                                                     |
| shuvkit    | `0.1.5` (`bfac2a6`) pinned to Shuvcode `8f7b0d8dc3`                                    | Swift keeps the password outside `ServerConfig`, but transport authentication is still implicit Basic; TypeScript embeds Basic fields in its client config                                       |
| OpenShuv   | `master` (`12e328b`) pinned to shuvkit `0.1.2`                                         | Manual/Bonjour onboarding, Basic password in device-only Keychain, no QR reader, and broad ATS cleartext allowance                                                                               |
| ClankerOne | M3 merged in PR #7 (`129db3e`); active `codex/project-directory-picker` at `9e797da`   | Has attachment camera and VisionKit document-scanner/OCR flows, but no QR barcode scanner and no direct Shuvcode mobile credential path; coordinate pairing changes with its active project work |

The M3 dependency sequence is complete, so the previous M2 coordination freeze no longer applies. Pairing starts from the current Shuvcode branch and shuvkit `0.1.5`; OpenShuv should move directly to the first immutable pairing release rather than taking an unrelated intermediate dependency-only change.

## Decision

Replace the credential-bearing QR payload with a versioned, one-time pairing invitation. Keep the existing administrator Basic credential for operator and compatibility use, and add per-device Bearer credentials for mobile clients.

The initial QR envelope is:

```json
{
  "v": 1,
  "kind": "shuvcode.pair",
  "urls": ["https://shuvdev.example"],
  "token": "<one-time-secret>",
  "expiresAt": "2026-07-14T20:00:00Z"
}
```

The envelope deliberately contains no administrator username or password. The invitation token is submitted in the redemption request body, never in a URL or query string.

## Pairing Flow

1. An authenticated operator requests a pairing invitation through the CLI or TUI.
2. The server creates a 32-byte cryptographically random, base64url-encoded single-use token with a three-minute lifetime.
3. The CLI or TUI renders the versioned envelope as a QR code.
4. The mobile app scans and validates the envelope locally.
5. The app shows the selected hostname, URL, and transport security state for confirmation.
6. The app allocates its stable local server ID, generates a redemption request UUID and a 32-byte base64url device credential, stores the invitation token and device credential in device-only Keychain plus non-secret pending metadata, and only then submits the credential, token, and a user-editable device name to the redemption endpoint.
7. The server atomically consumes the invitation, stores only the device-credential hash, and creates a device record.
8. The server returns the device ID. An exact retry with the same request ID, invitation, and credential reconciles to the same device.
9. The app verifies Bearer access, promotes the pending Keychain record to the active device credential, and deletes the invitation token only after reconciliation succeeds.
10. The operator can later list or revoke that device without affecting other clients.

## API Surface

| Method   | Path                            | Authentication            | Purpose                         |
| -------- | ------------------------------- | ------------------------- | ------------------------------- |
| `POST`   | `/api/pairing/invitation`       | Administrator Basic auth  | Create a short-lived invitation |
| `POST`   | `/api/pairing/redeem`           | One-time invitation token | Enroll one device credential    |
| `GET`    | `/api/pairing/device`           | Administrator Basic auth  | List paired devices             |
| `DELETE` | `/api/pairing/device/:deviceID` | Administrator Basic auth  | Revoke one paired device        |

`POST /api/pairing/redeem` is the only route that bypasses ordinary server credentials. Possession and successful consumption of the invitation token authenticates that request. The exception must be exact-route and method constrained, following the PTY ticket exception rather than making the pairing group generally public.

The public error contract is:

| Error                               | HTTP | Meaning                                                                                           |
| ----------------------------------- | ---: | ------------------------------------------------------------------------------------------------- |
| `InvalidRequestError`               |  400 | Malformed request, invalid UUID, name, token, or credential format                                |
| `UnauthorizedError`                 |  401 | Missing or invalid Basic/Bearer credentials on an authenticated route                             |
| `ForbiddenError`                    |  403 | An authenticated device principal attempted an administrator-only capability                      |
| `PairingConflictError`              |  409 | A supposedly idempotent retry changed its request ID, invitation, or credential                   |
| `PairingInvitationUnavailableError` |  410 | Invitation is expired, unknown, restarted away, or consumed without a matching durable enrollment |
| `PairingDeviceNotFoundError`        |  404 | Revocation referenced an unknown device ID                                                        |

### Create invitation response

```json
{
  "v": 1,
  "kind": "shuvcode.pair",
  "urls": ["https://shuvdev.example"],
  "token": "<one-time-secret>",
  "expiresAt": "2026-07-14T20:00:00Z"
}
```

### Redeem invitation request

```json
{
  "token": "<one-time-secret>",
  "requestID": "<client-generated-uuid>",
  "deviceName": "Shuv's iPhone",
  "credential": "<client-generated-device-secret>"
}
```

### Redeem invitation response

```json
{
  "deviceID": "device_..."
}
```

The response must not expose the stored credential hash or administrator credential. The server never stores the raw device secret and does not need to reproduce it after a response is lost.

The device credential wire format is `scd_v1_<base64url>` where the suffix decodes to exactly 32 bytes. The prefix gives clients and logs a non-secret credential-type discriminator without weakening the secret. Invitation tokens use the same 32-byte entropy but have no reusable credential prefix.

Wire schemas require a canonical UUID `requestID`, a trimmed device name from 1 through 80 Unicode scalar values, the exact credential format above, and a 32-byte base64url invitation token. Invitation responses must remain below the 4 KiB scanner limit. Device list responses expose only `deviceID`, name, creation/update timestamps, and revocation state; they never expose request IDs or hashes. Revocation is idempotent for an existing device and returns not found for an unknown ID.

### Redemption recovery

The redemption operation must reconcile exact retries. A durable unique `request_id` and a hash of the invitation proof allow the server to return the same device record only when the request ID, invitation, and submitted credential hash match the original enrollment.

The mobile client must distinguish:

- A definite rejection before enrollment, which may safely return to scanning.
- A timeout before it is known whether the server committed, which must retain pending state and probe Bearer authentication.
- A successful Bearer probe after an ambiguous redemption, which proves enrollment completed even if the redemption response was lost.
- A retry, which must reuse the same request ID, credential, and selected server rather than redeeming through another advertised URL as a new device.

Expired, restarted-away, and unknown invitations return `PairingInvitationUnavailableError` with HTTP 410 when there is no matching durable enrollment. An exact retry reconciles from the durable device row. Any durable uniqueness collision on request ID, invitation digest, or credential digest that does not match the complete committed tuple returns `PairingConflictError` with HTTP 409. This matches what the process-local invitation model can prove and avoids giving clients false precision.

## Durable Model

Add one durable `pairing_device` table. Field names follow the repository's snake_case Drizzle convention and its existing `time_created`/`time_updated` timestamp helpers.

| Field             | Purpose                                                        |
| ----------------- | -------------------------------------------------------------- |
| `id`              | Stable public device identifier                                |
| `request_id`      | Unique client request ID for exact-retry reconciliation        |
| `name`            | Operator-visible device label                                  |
| `credential_hash` | Hash of the client-generated secret; raw value is never stored |
| `invitation_hash` | Hash binding an exact retry to its enrollment invitation       |
| `time_created`    | Enrollment timestamp from the shared timestamp helper          |
| `time_updated`    | Last durable record mutation from the shared timestamp helper  |
| `time_revoked`    | Nullable revocation timestamp                                  |

Invitation state may remain process-local for the first implementation. The cache stores the invitation digest as its key rather than retaining the raw token, is capped at 1,024 outstanding invitations, and atomically consumes entries. Restarting the server invalidates outstanding QR codes, which is safe and understandable. Do not persist invitations unless a concrete need for restart survival emerges.

`request_id`, `credential_hash`, and `invitation_hash` each require a unique index. Device credentials and invitations are high-entropy random values, so V1 stores their SHA-256 digests as fixed-length lowercase hex. Authentication hashes the presented credential and performs the indexed digest lookup; any in-memory digest comparison uses constant-time equality. A slow password KDF is unnecessary for 256-bit generated secrets and would add cost without improving resistance to offline guessing.

Do not add `last_used_at` in V1. Updating it on normal requests would put a write on the authentication path or require a new coalescing subsystem before there is a concrete product use for the data.

## Authentication Changes

The server authorization layer will authenticate either:

- The existing configured administrator Basic credential.
- A Bearer device credential whose hash matches a non-revoked device record.

Successful authentication must produce an explicit request principal such as `administrator` or `device(deviceID)`, not only a boolean result. Pairing-management routes then apply a separate administrator-authorization middleware and reject device principals.

Authentication and authorization remain separate modules. The global authentication middleware validates Basic or Bearer credentials and supplies the principal. Protocol-owned capability metadata declares whether an endpoint accepts `mobile` or requires `administrator`, and server middleware enforces it. A device principal is fail-closed by default: V1 grants `mobile` only to the exact methods and paths governed for OpenShuv in shuvkit's `contract/contract-usage.json`. Credential, integration, plugin, MCP, debug, PTY, shell, project-copy, pairing-management, and any new unclassified endpoints remain administrator-only. The contract checker must assert the mobile allowlist so a newly generated endpoint cannot silently become device-accessible.

### Mobile capability source of truth

Protocol endpoint metadata is the runtime source of truth. During the shuvkit publication phase, add a `mobileCapabilities` array of exact `{ method, path }` pairs to `contract/contract-usage.json` as its governed mirror. Seed it from the Swift `OpenCodeClient` methods used by OpenShuv plus the global `/api/event` and per-session `/api/experimental/session/{id}/log` SSE streams. Do not authorize an entire group or all methods on a path merely because one operation is mobile-facing.

CI must prove that every governed mobile pair exists in OpenAPI, carries `mobile` metadata in Protocol, and has a characterized ShuvKit request. It must also prove that every Swift request OpenShuv can issue is classified as mobile or intentionally rejected. Basic administrator requests bypass this device-capability restriction after successful authentication; Bearer device requests do not.

The exact-method `POST /api/pairing/redeem` exception reaches its handler without a principal; the handler authenticates by consuming or reconciling the invitation. Embedded or otherwise unauthenticated servers must not issue invitations or manage paired devices.

Credential verification must:

- Require at least 256 bits of cryptographically random input for client-generated device secrets.
- Store only a SHA-256 digest of each generated secret.
- Use the indexed fixed-length digest for lookup and constant-time equality for any comparison performed in memory.
- Avoid logging invitation tokens, device credentials, or authorization headers.
- Reject malformed Bearer values before database lookup and reject revoked records immediately.
- Return both Basic and Bearer authentication challenges where the HTTP stack permits multiple `WWW-Authenticate` values.

### Mobile authentication representation

ShuvKit Swift must model transport authentication explicitly as `none`, `basic`, or `deviceBearer`, with the secret supplied separately from non-secret server metadata. The Swift client must retain its existing `init(config:password:session:)` Basic initializer as a compatibility surface while a designated initializer accepts the explicit authentication kind and opaque credential.

OpenShuv must persist a non-secret authentication-kind discriminator alongside each server and keep the opaque secret in Keychain. Decoding an older saved `ServerConfig` with no discriminator must infer Basic when a username exists and unauthenticated access otherwise; a required new field would cause the current cache decoder to silently drop existing servers.

Pairing redemption must use a dedicated credential-free pairing client path that cannot accidentally attach an existing Basic or Bearer header. Do not add an `omitAuthentication` boolean to the general request helper; the separate interface makes the security property testable.

## QR and Transport Rules

- Reject unknown `kind` values and unsupported versions.
- Reject scanned payloads larger than 4 KiB before decoding JSON.
- Accept only `http` and `https` server URLs.
- Reject userinfo, query strings, fragments, and unexpected paths in pairing URLs.
- Probe advertised URLs without sending the invitation token; an authenticated server's HTTP 401 is sufficient to establish reachability for selection.
- Prefer HTTPS when more than one advertised URL is reachable.
- Pairing V1 permits HTTPS and loopback HTTP only. OpenShuv's existing manual onboarding may retain its current cleartext warning during migration, but a scanned invitation containing non-loopback HTTP is rejected.
- Never place an invitation or device credential in a custom URL, query string, analytics event, crash report, or pasteboard automatically.
- Display the selected hostname and transport security state before redemption.
- Cap outstanding process-local invitations at 1,024. V1 relies on 256-bit invitation entropy rather than proxy-sensitive IP attempt tracking.
- Bound parallel reachability probes and persist only the selected URL; the complete advertised list remains informational.

## Coordination Baseline

The old ClankerOne M2 freeze is closed. M3 merged in dependency order as Shuvcode PR #334, shuvkit PR #3 and release `0.1.5`, then ClankerOne PR #7. Pairing implementation and coordination may now proceed across all four repositories from this hub.

Keep the same publication discipline:

1. Land and verify Shuvcode pairing first without changing shuvdev.
2. Advance shuvkit's exact Shuvcode pin, OpenAPI snapshot, contract declarations, tests, and immutable tag from the clean `0.1.5` baseline.
3. Update OpenShuv to that immutable pairing tag and complete simulator, hosted-CI, and signed-device gates.
4. Advance ClankerOne's shuvkit submodule to the same governed tag, update deployment and operations material where the shared topology changes, and rerun its bridge, iOS, and live compatibility gates.
5. Change shuvdev's listener/advertisement topology only during the explicit live-rollout phase.

ClankerOne work is coordinated here like the other projects. Preserve and sequence its active branch normally, but do not treat the repository as immutable or excluded from dependency, deployment, documentation, scanner-sharing, or compatibility changes required by pairing.

This shared coordination thread is the control plane for cross-project ordering and gates; repository-specific implementation remains in the dedicated Shuvcode, shuvkit, OpenShuv, and ClankerOne execution threads.

## Implementation Plan

### Phase 1: Shuvcode pairing domain

1. Add pairing wire schemas in `packages/schema`.
2. Add `pairing/sql.ts`, the `pairing_device` model, unique indexes, and a generated migration in `packages/core`.
3. Add one process-global `Pairing.Service` module in `packages/core`. Its external interface is limited to issuing invitations, redeeming enrollment, authenticating a device credential, listing devices, and revoking a device. It hides the invitation cache, per-token redemption serialization, hashing, and database implementation, and tests exercise behavior through this interface.
4. The module must:
   - issue process-local expiring invitations;
   - atomically consume each invitation once;
   - validate and hash client-generated per-device credentials;
   - serialize competing redemption attempts for the same invitation so one exact retry cannot transiently race another into a false conflict;
   - reconcile committed retries before consulting the process-local invitation cache; and
   - list and revoke durable device records.
5. Add the pairing endpoints, pairing errors, principal context, and capability metadata to `packages/protocol` without introducing a Protocol-to-Core dependency.
6. Add handlers and narrowly scoped exact-method redemption bypass in `packages/server`. Replace the current URL-only PTY exception check with explicit request classifiers so `POST /api/pairing/redeem` is the only pairing route that can reach a handler without a principal.
7. Extend server authentication to recognize device Bearer credentials, produce an authenticated principal, and enforce protocol-declared capabilities while preserving administrator Basic authentication and the existing PTY ticket behavior.
8. Add an independently validated advertised-URL setting to the server/managed-service configuration. Bind addresses and advertised addresses are different concerns: shuvdev must continue binding Shuvcode to `127.0.0.1:4096` while `/api/server` and invitations advertise its tailnet HTTPS URL.
9. When one or more advertised URLs are configured, `/api/server` and invitation creation return that validated list instead of appending runtime bind URLs. Without the setting, retain today's runtime URL discovery. Advertised values follow the same no-userinfo/query/fragment/path and HTTPS-or-loopback rules as scanned envelopes.
10. Run `bun run generate` from `packages/client` after the public Protocol and Server `HttpApi` are final.
11. Do not edit generated client directories directly.

### Phase 2: Operator QR surfaces

1. Update `shuvcode pair` to create an invitation and render the versioned envelope.
2. Stop printing or encoding the administrator password in pairing output. Human-readable output contains only advertised URLs and invitation expiry.
3. Update the TUI Pair dialog to request an invitation and display its expiration.
4. Provide clear states for expiration, server unavailability, and regeneration.
5. Preserve the current localhost warning and multi-URL display, but direct remote operators to configure an advertised URL rather than changing a loopback bind to `0.0.0.0` when a reverse proxy or Tailscale Serve is the intended ingress.
6. Add `shuvcode device list` and `shuvcode device revoke <deviceID>` administrator commands, and expose the same list/revoke actions in the TUI Pair dialog so per-device revocation is operable rather than API-only.

### Phase 3: shuvkit support

1. Start from the immutable `0.1.5` baseline and add a strict `PairingEnvelope` decoder with version and kind discrimination.
2. Add a dedicated pairing URL validator and deterministic, bounded reachable-URL selection; do not reuse the permissive manual `ServerURLNormalizer`.
3. Add a small pairing module whose interface decodes an envelope, selects an eligible URL, and redeems one prepared enrollment. Keep URL probing and credential-free transport inside the module so OpenShuv does not duplicate them.
4. Add Bearer transport support to the Swift client.
5. Add a non-secret `none`/`basic`/`deviceBearer` authentication kind with backward-compatible decoding while keeping secrets outside `ServerConfig`.
6. Add typed pairing errors and map invitation-unavailable, conflicting-retry, malformed, cleartext, and unsupported-version responses into actionable Swift errors.
7. After the Shuvcode API is stable, update the exact Shuvcode pin and OpenAPI snapshot, then add all pairing paths, operation-shape checks, error schemas, capability declarations, fixtures, and live characterization.
8. Run `contract/check-contract.sh` to prove the declared shared-client contract still matches Shuvcode; this checker does not discover undeclared new APIs automatically.
9. Defer TypeScript pairing APIs and its existing `ServerConfig` authentication refactor until a concrete TypeScript consumer requires them. ClankerOne currently consumes Shuvcode through its bridge rather than redeeming a Shuvcode mobile credential, but its governed dependency may still advance with the shared release.

Admin invitation creation and device list/revoke remain in Shuvcode's generated clients, CLI, and TUI. ShuvKit's first mobile surface needs only envelope parsing, URL selection, redemption, and Bearer transport.

### Phase 4: OpenShuv onboarding

1. Add `NSCameraUsageDescription`, regenerate the checked-in Xcode project metadata, and add a QR scanner entry point to Add Server.
2. Parse and validate the envelope before making a network request.
3. Show a confirmation screen with hostname, selected URL, expiry, and transport state. Scanned non-loopback cleartext is rejected rather than offered as a confirmable warning.
4. Allocate the stable local server identity, request ID, and device credential before redemption. Store the invitation token and device credential in a versioned pending Keychain record using the existing device-only accessibility policy; store only URL, expiry, request ID, device name, and local server ID in recoverable non-secret pending metadata.
5. Redeem or reconcile, verify authenticated server access, then atomically promote the Keychain entry to the active device credential and save non-secret server metadata with `deviceBearer` authentication.
6. Delete pending secrets after a definite rejection or successful promotion; retain recoverable pending state after ambiguous network failure and resume it on next launch while the invitation may still reconcile.
7. Rename password-specific OpenShuv Keychain APIs to opaque credential terminology and introduce versioned secret records without changing device-only accessibility or breaking the existing plain-string Basic entries.
8. Keep manual URL and Basic credential entry as a fallback during migration.
9. Add recovery UX for invitation-unavailable, conflicting-retry, unreachable, malformed, cleartext, and unsupported-version failures.
10. Put camera access behind a scanner abstraction or injectable scanned-payload path so parser and onboarding tests do not require Simulator camera input.

### Phase 5: Migration and rollout

1. Preserve Shuvcode on `127.0.0.1:4096`, ClankerOne on `127.0.0.1:8787`, and its attachment handoff on `127.0.0.1:8788`.
2. Add a dedicated tailnet-only Tailscale Serve HTTPS listener at port `10001` forwarding to Shuvcode `127.0.0.1:4096`; keep ClankerOne on HTTPS port `10000`. Do not expose port 8788.
3. Update the ClankerOne-owned deployment and operations material for the additional tailnet listener, configure Shuvcode's advertised URL as `https://<host>.<tailnet>.ts.net:10001` while retaining its loopback bind, and deploy the coordinated server changes without collapsing the two credential domains.
4. Verify administrator Basic authentication still works for existing tools.
5. Run ClankerOne's package, bridge health, session, governed attachment, iOS, and live smoke gates against its updated shuvkit pin and the replaced Shuvcode process.
6. Pair one development device and verify reconnect across app and server restarts.
7. Revoke that device and prove subsequent requests fail without affecting other clients.
8. Ship the OpenShuv build for real-device dogfooding.
9. Keep the legacy credential-bearing QR decoder out of production unless a temporary compatibility decision is made explicitly.

## Verification Gates

### Shuvcode

- Pairing invitation can be consumed exactly once under concurrent redemption.
- An exact redemption retry reconciles to one device, while a changed request ID, credential, or invitation fails closed.
- Concurrent exact retries serialize to one device and one consistent response; competing non-identical redemption loses without creating a second row.
- A lost redemption response can be recovered using retained client credential state and an authenticated probe.
- Expired, unknown, malformed, and previously consumed invitations fail.
- Server restart invalidates process-local invitations.
- Client-generated device secrets are accepted only during redemption and never returned or stored raw.
- Revoked credentials fail authentication immediately.
- One device can be revoked without invalidating another.
- Device credentials cannot create invitations, list devices, or revoke devices.
- Device credentials can access only the protocol-declared mobile capability allowlist; administrator-only and unclassified routes return forbidden.
- Unauthenticated and embedded servers cannot expose pairing management.
- Existing administrator Basic authentication remains compatible.
- Unauthenticated access to every route except exact pairing redemption remains rejected.
- Generated promise and Effect clients compile against the final API.
- Loopback bind configuration and public advertised URL configuration are independently validated and tested.
- Run tests and `bun typecheck` from the affected package directories, never the repository root.

### shuvkit and OpenShuv

- Envelope decoding rejects oversized, malformed, unknown-kind, and unsupported-version input.
- Reachable URL selection behaves deterministically with multiple advertised URLs.
- Scanned non-loopback cleartext is rejected; loopback HTTP is visibly identified.
- The active post-pairing Keychain record contains only the device credential; the temporary invitation token is removed after successful promotion.
- A process termination before or after the redemption response can recover from the versioned pending Keychain record without storing either secret in SQLite or UserDefaults.
- Legacy saved servers decode with the same Basic or unauthenticated behavior after the authentication-kind migration.
- Expired and replayed QR codes produce actionable UI errors.
- An injected scanner payload can drive parser and onboarding tests without camera hardware.
- Manual server onboarding continues to work.
- Package tests, app-level simulator build, hosted CI, and a signed-device build pass before rollout is considered complete.

### Live shuvdev

- `GET /api/server` advertises `https://<host>.<tailnet>.ts.net:10001` while the Shuvcode process remains bound only to `127.0.0.1:4096`.
- Tailscale Serve keeps HTTPS 10000 mapped to ClankerOne 8787 and adds HTTPS 10001 mapped to Shuvcode 4096; port 8788 remains unadvertised.
- Pairing works against the systemd-managed service through the same wrapper and XDG configuration used in production.
- ClankerOne's Basic-auth bridge path and loopback attachment handoff still pass their M3 compatibility smoke after its governed shuvkit update and the Shuvcode replacement.
- Logs contain no invitation token, device secret, administrator password, or authorization header.
- A real device can reconnect after both app termination and server restart.

## ClankerOne Integration

ClankerOne is managed as part of this multi-project plan. Its repository may receive dependency, deployment, documentation, shared scanner, test, or compatibility changes when they are required to keep the complete system aligned.

Its iOS app authenticates to the ClankerOne bridge with a static Bearer token rather than connecting directly to Shuvcode. A future ClankerOne pairing design may reuse the versioned envelope and scanner components, but the bridge must issue and redeem its own credential type. Shuvcode must not issue credentials that bypass the bridge architecture.

Keep three concepts distinct in schemas, storage, UI copy, and operational docs:

- A Shuvcode authenticated-device credential issued through this plan.
- A ClankerOne bridge credential accepted by the bridge.
- An APNs device-registration token used only for push delivery.

ClankerOne M3 now provides camera capture and a VisionKit document scanner with OCR for attachments. That implementation does not recognize QR barcodes and is not currently packaged as a shared module. OpenShuv owns the first Shuvcode QR onboarding flow, but reusable scanner infrastructure may be deliberately moved into shuvkit or adopted by ClankerOne when doing so creates a real shared seam.

The architectural distinction is still mandatory: ClankerOne's phone authenticates to its bridge, not directly to Shuvcode. If ClankerOne gains QR onboarding, the bridge issues and redeems its own credential even if it shares envelope and scanner modules with OpenShuv.

## Non-Goals

- Replacing administrator Basic authentication in the first release.
- General OAuth, passkeys, cloud accounts, or cross-server identity federation.
- Persisting unused invitations across server restarts.
- Pairing over Bluetooth or peer-to-peer transport.
- Automatically trusting every URL contained in a scanned QR code.
- Changing V1 code under `packages/opencode`.
- Replacing ClankerOne's bridge credential with a Shuvcode device credential.
- Recording per-request device usage timestamps in V1.
- Adding a durable server fingerprint or public-key identity in the first envelope; V1 confirmation shows the selected HTTPS hostname and transport state.

## Resolved Implementation Decisions

1. Device credentials and invitations contain 32 random bytes; the server stores fixed-length SHA-256 hex digests and never raw values.
2. V1 does not add a durable server fingerprint. Confirmation uses the selected HTTPS hostname and transport state.
3. Scanned pairing permits HTTPS and loopback HTTP only. Non-loopback cleartext remains available solely through the existing manual onboarding path during migration.
4. V1 omits `last_used_at` rather than introducing writes or coalescing on the authentication path.
5. Device principals are fail-closed and receive only the exact OpenShuv methods and paths declared in shuvkit's governed contract; explicit protocol capability metadata and contract checks enforce the set.
6. shuvdev keeps all processes loopback-only and adds Tailscale Serve HTTPS 10001 for direct Shuvcode access alongside ClankerOne HTTPS 10000.
7. Server bind addresses and advertised URLs are separate configuration. Pairing never asks an operator to widen the Shuvcode bind merely to publish a reverse-proxy address.
8. Pending enrollment secrets are written to device-only Keychain before redemption. Non-secret recovery metadata may be durable elsewhere, and promotion to an active credential occurs only after Bearer verification.

These decisions are part of the V1 contract and must be reflected in schemas and tests before generated clients are published.
