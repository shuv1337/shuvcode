# PR Feature Verifier

Review the PRs listed in README.md and verify each feature is still implemented in the codebase.

## Instructions

1. Read the README.md file to get the list of merged PRs and their descriptions
2. For each PR listed in the "Merged PRs (Pending Upstream)" table, spawn a parallel Explore agent to verify the feature is implemented
3. Each agent should:
   - Search for the key components described in the PR
   - Check relevant files for the implementation
   - Verify the feature hasn't been overwritten by upstream merges
   - Report what was found and whether it appears fully implemented

4. Collect all results and produce a summary table with:
   - PR number and title
   - Implementation status (IMPLEMENTED / PARTIAL / MISSING)
   - Brief notes on what was found or what's missing

5. If any features are missing or partial, provide actionable recommendations for restoration

## Output Format

Produce a markdown table summary like:

| PR | Feature | Status | Notes |
|----|---------|--------|-------|
| #XXXX | Feature name | STATUS | Brief explanation |

Then list any action items for features that need attention.
