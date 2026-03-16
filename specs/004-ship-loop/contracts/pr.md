# Pull Request Contract

**Path**: `specs/004-ship-loop/contracts/pr.md`
**Phase**: 3

This contract defines the execution behavior of the CI/CD integration payload at the end of the `gwrk ship` autonomous loop.

## The Push & PR Guarantee

When the `ship` run completes with 0 exit code (all gates pass, all phases complete):

1. **Commit**: All agent-authored changes must be committed.
2. **Push**: The target branch (`feat/test-feature-wip`) must be pushed to origin.
3. **PR Context**: The output artifact is either a PR creation command or a direct GitHub API payload emitting:
   - PR Title: `[gwrk] Feature 004 Ship Verification`
   - PR Body: The content of the execution manifest.

## `T019` Gate Constraints

Gate `T019-gate.sh` asserts that:
- The `gwrk ship` terminal orchestration calls the GitHub CLI (`gh pr create` or equivalent) or includes a mock implementation of CI integration that adheres to this contract.
- The workflow correctly handles waiting for CI execution if required by `config.yml`.

## Mock Implementation
If a remote origin does not exist, the implementation must gracefully skip pushing and output a warning rather than crashing `gwrk ship` (fail-fast does not apply to disconnected remotes).
