# CI Runner Configuration - December 2024

## Context

The `shuvcode` repository is a public fork of `sst/opencode` that automatically syncs upstream releases, resolves merge conflicts (via OpenCode agent), and publishes to npm as `shuvcode`.

## Current State

### Upstream Sync Pipeline (Fully Automated)

- Detects new upstream releases every 5 minutes
- Attempts automatic merge
- Creates GitHub issues for conflicts/validation failures
- Triggers OpenCode agent to resolve issues automatically
- Auto-closes issues when sync succeeds
- Publishes to npm via snapshot workflow

### CI Runner Configuration

**Decision: Use Blacksmith runners via Latitudes-Dev organization**

All workflows now use hardcoded `blacksmith-4vcpu-ubuntu-2404` runners.

| Runner Type | Status | Notes |
|-------------|--------|-------|
| Blacksmith | Active | Fast execution, no queue delays |
| GitHub-hosted | Removed | Was slow (20+ min queue times) |
| Self-hosted | Removed | Security concerns for public repos |

### Migration Completed

- [x] Repository transferred to `Latitudes-Dev/shuvcode`
- [x] Blacksmith enabled for the organization
- [x] All workflows updated to use Blacksmith runners
- [x] Self-hosted runner files removed (security)
- [x] Secrets configured in new organization

## Workflows Using Blacksmith

All workflows in `.github/workflows/` now use `runs-on: blacksmith-4vcpu-ubuntu-2404`:

- `deploy.yml`
- `format.yml`
- `notify-discord.yml`
- `opencode.yml`
- `publish.yml`
- `publish-github-action.yml`
- `publish-vscode.yml`
- `snapshot.yml`
- `stats.yml`
- `sync-zed-extension.yml`
- `test.yml`
- `typecheck.yml`
- `update-nix-hashes.yml`
- `upstream-sync.yml`

## Commands Reference

### Check Workflow Status

```bash
gh run list --repo Latitudes-Dev/shuvcode --limit 10
gh run view <run-id> --repo Latitudes-Dev/shuvcode
```

### Trigger Upstream Sync Manually

```bash
gh workflow run upstream-sync.yml --repo Latitudes-Dev/shuvcode -f force_sync=true
```

### View Open Issues

```bash
gh issue list --repo Latitudes-Dev/shuvcode --state open --label upstream-sync
```

## Related Files

- `.github/workflows/upstream-sync.yml` - Main sync workflow
- `.github/workflows/opencode.yml` - OpenCode agent trigger
- `.github/workflows/snapshot.yml` - Publish workflow

## Historical Notes

### Why Not Self-Hosted Runners?

Self-hosted runners on public repos pose security risks: anyone can fork the repo, create a PR with malicious workflow code, and execute arbitrary code on your server. PR-triggered workflows (format, test, typecheck) would be vulnerable.

### Why Blacksmith?

- Fast execution (no 20+ minute queue delays)
- Hosted service (no security concerns)
- Requires GitHub Organization (hence migration to Latitudes-Dev)
