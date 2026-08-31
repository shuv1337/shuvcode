# Shuvcode

Shuvcode is the Latitudes-Dev fork of OpenCode V2. It preserves OpenCode-compatible configuration and data paths while shipping the `shuvcode` CLI, shared background service, terminal UI, and Promise client facade.

## Install

```sh
npm install --global shuvcode
```

The supported release product is the CLI distribution. Desktop applications, containers, editor extensions, and upstream installers are not published by this fork.

## Use

```sh
shuvcode
shuvcode service status
shuvcode api get /api/health
```

The shared service uses one administrator credential. Managed hosts delegate lifecycle operations to `shuvcode.service`; portable installs use the CLI's elected detached service. There is no built-in device pairing or per-device credential revocation.

## Develop

The default branch is `integration-v2`. Run package tests and typechecks from the package directory, never from the repository root. See `AGENTS.md` for architecture and validation rules.

## Release

Releases are manual and fork-only through `.github/workflows/publish.yml`. See `PLAN-v2-release-publish.md` for the non-mutating preflight and package matrix.

Upstream source and history remain available from [anomalyco/opencode](https://github.com/anomalyco/opencode). Do not open Shuvcode pull requests against upstream.
