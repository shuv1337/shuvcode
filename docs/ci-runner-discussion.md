# CI Runner Discussion - December 2024

## Context

The `shuvcode` repository is a public fork of `sst/opencode` that automatically syncs upstream releases, resolves merge conflicts (via OpenCode agent), and publishes to npm as `shuvcode`.

## Current State

### What's Working

1. **Upstream Sync Pipeline** - Fully automated:
   - Detects new upstream releases every 5 minutes
   - Attempts automatic merge
   - Creates GitHub issues for conflicts/validation failures
   - Triggers OpenCode agent to resolve issues automatically
   - Auto-closes issues when sync succeeds
   - Publishes to npm via snapshot workflow

2. **Workflows Fixed This Session**:
   - `upstream-sync.yml` - Uses PAT_TOKEN for triggering opencode workflow
   - `opencode.yml` - Sets up Bun and installs deps before running (fixes pre-push hook)
   - Added `close-issues-on-success` job to auto-close upstream-sync issues

### Current CI Runner Situation

| Runner Type                     | Status                         | Notes                                    |
| ------------------------------- | ------------------------------ | ---------------------------------------- |
| GitHub-hosted (`ubuntu-latest`) | Slow, unreliable               | 20+ minute queue times observed          |
| Blacksmith                      | Configured upstream            | Not available for personal account forks |
| Self-hosted                     | Setup created but not deployed | Security concerns for public repos       |

### Files Created for Self-Hosted Runners

```
.github/runner/
├── Dockerfile           # Ubuntu 24.04 + bun, node, go, docker, gh
├── docker-compose.yml   # Container orchestration
├── entrypoint.sh        # Runner startup script
├── setup.sh             # Interactive setup wizard
└── README.md            # Documentation
```

Workflows updated to use `${{ vars.RUNNER_LABEL || 'blacksmith-4vcpu-ubuntu-2404' }}` for flexible runner selection.

## Security Concerns

### Self-Hosted Runners on Public Repos

**Risk**: Anyone can fork the repo, create a PR with malicious workflow code, and if it runs on your self-hosted runner, they execute arbitrary code on your server.

**Affected Workflows** (PR-triggered):

- `format.yml`
- `opencode.yml`
- `test.yml`
- `typecheck.yml`
- `update-nix-hashes.yml`

### Mitigations (if using self-hosted)

1. Only run self-hosted on protected branch workflows (not PR-triggered)
2. Require approval for first-time contributors
3. Use ephemeral runners that are destroyed after each job
4. Network isolation for the runner

## Open Questions

### 1. Blacksmith Access

- Blacksmith requires GitHub Organization, not personal account
- Option: Migrate `kcrommett/shuvcode` to `LatitudesDev/shuvcode`
- Pros: Fast runners, no queue delays, no security concerns
- Cons: Migration overhead, URL changes

### 2. Self-Hosted Runner Decision

- Keep the setup files for potential future use?
- Remove them since they're a security risk for public repos?
- Only use for specific trusted workflows?

### 3. Alternative CI Services

Other options if GitHub Actions continues to be slow:

- **CircleCI** - Good free tier, fast
- **Buildkite** - Fast, self-hosted option with better security model
- **Dagger** - Portable CI pipelines
- **Depot** - Fast container builds

### 4. Hybrid Approach

- Use GitHub Actions for simple/fast jobs
- Use self-hosted only for `integration` branch (no PR triggers)
- Requires workflow refactoring

## Recommendations

### Short-term (Now)

1. Keep using GitHub-hosted runners (accept slow queue times)
2. Remove self-hosted runner files from repo (security)
3. Or keep files but don't deploy/enable them

### Medium-term Options

**Option A: Migrate to Org + Blacksmith**

- Move repo to LatitudesDev org
- Enable Blacksmith for fast runners
- No security concerns (hosted service)

**Option B: Self-Hosted with Restrictions**

- Deploy self-hosted runner
- Configure to only run on `integration` branch pushes
- Exclude from PR-triggered workflows
- Accept some security risk

**Option C: Alternative CI**

- Evaluate CircleCI or Buildkite
- May require significant workflow rewrite

## Action Items

- [ ] Decide on org migration (for Blacksmith access)
- [ ] Decide whether to keep/remove self-hosted runner files
- [ ] If keeping self-hosted, restrict to protected branches only
- [ ] Consider setting up runner on dev server for testing

## Commands Reference

### Check Workflow Status

```bash
gh run list --repo kcrommett/shuvcode --limit 10
gh run view <run-id> --repo kcrommett/shuvcode
```

### Trigger Upstream Sync Manually

```bash
gh workflow run upstream-sync.yml --repo kcrommett/shuvcode -f force_sync=true
```

### View Open Issues

```bash
gh issue list --repo kcrommett/shuvcode --state open --label upstream-sync
```

## Related Files

- `.github/workflows/upstream-sync.yml` - Main sync workflow
- `.github/workflows/opencode.yml` - OpenCode agent trigger
- `.github/workflows/snapshot.yml` - Publish workflow
- `.github/runner/` - Self-hosted runner setup (not deployed)
