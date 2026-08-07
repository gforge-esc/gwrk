# Pull Request Contract

**Path**: `specs/004-ship-loop/contracts/pr.md`
**Phase**: 3

This contract defines the execution behavior of the CI/CD integration payload at the end of the `gwrk ship` autonomous loop.

## The Push & PR Guarantee

When the `ship` run completes with 0 exit code (all gates pass, all phases complete):

1. **Commit**: All agent-authored changes must be committed.
2. **Push**: The target branch (`feat/test-feature-wip`) must be pushed to origin.
3. **PR Context**: The output artifact is either a PR creation command or a direct GitHub API payload emitting:
   - PR Title: `feat(<spec>): Phase N`, or `Phases N–M` when the PR carries more than one.
   - PR Body: Per-phase task checkboxes and recorded verdicts, plus the span marker below.

## One PR Per Run, Named For What It Carries

The guarantee above is scoped to the **run**, not the phase. `gwrk ship <feature>`
with no phase argument ships every open phase sequentially on one branch
(FR-013) and executes PR_CI once per phase, so phases 2..N land on the PR that
phase 1 opened. Reusing that PR is correct — opening one per phase would fight
the run-scoped contract.

What the PR MUST NOT do is keep the identity of whichever phase created it. On
every PR_CI:

- The title names every phase the PR carries (`prPhaseLabel`): `Phase 4`,
  `Phases 1–4` when contiguous, `Phases 1, 3, 4` when a merge or skip broke the
  run.
- The body lists each carried phase's tasks and the verdicts **recorded for
  that phase**. A phase whose verdicts are unknown reads `not recorded`; the
  body never asserts a GO it cannot source.
- A reused PR is updated in place via `gh pr edit`. A failed edit warns and does
  not fail an otherwise green phase.

### The Span Marker

The carried span is persisted in the PR body, not in `ShipState`:

```
<!-- gwrk:pr {"phases":[{"id":"phase-01","gate":"PASS","review":"GO"}]} -->
```

`ShipState` is per-phase (`.runs/<feature>_<phase>.state`) and cannot carry the
span across phases. Reading it back off the PR also survives crash-resume, and
re-minting after a mid-feature merge closes the previous PR — the new PR then
correctly claims only the phases it actually carries.

Degradation is defined: a body with no marker (written by an older gwrk) has its
span recovered from the title; a corrupt marker falls back the same way; a
re-shipped phase updates its record rather than appearing twice.

Because `gh pr list` matches only **open** PRs, a human merge mid-feature ends
one PR's span and starts the next. That boundary is expected and recorded, not
silently inherited.

## `T019` Gate Constraints

Gate `T019-gate.sh` asserts that:
- The `gwrk ship` terminal orchestration calls the GitHub CLI (`gh pr create` or equivalent) or includes a mock implementation of CI integration that adheres to this contract.
- The workflow correctly handles waiting for CI execution if required by `config.yml`.

## Mock Implementation
If a remote origin does not exist, the implementation must gracefully skip pushing and output a warning rather than crashing `gwrk ship` (fail-fast does not apply to disconnected remotes).
