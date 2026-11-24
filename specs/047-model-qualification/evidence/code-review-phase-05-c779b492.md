# Phase 5 CLI review routing

NO-GO for `c779b492`. Editing the active CLI code review prompt left its model pin usable. The model qualification owner must repair prompt validation in T022 before Phase 5 advances.

## Reproduction

The test asks the project’s review plugin to select its code review workflow. The first request to a synthetic backend uses the pinned model and contains the original project instructions. After the test edits only that prompt, the runtime dispatches a second request. Acceptance criterion 5 requires requalification before dispatch. [Regression test](../../../src/application/models/resolve-route.test.ts#L840)

The CLI review plugin selects `review-code-cli`. The fingerprint loop only visits `gwrk-review-code` for the review role. Include the selected code review template in the fingerprint used for qualification and dispatch. [CLI review manifest](../../../src/plugins/builtins/reviews/review-cli/manifest.yaml#L6) · [Fingerprint calculation](../../../src/adapters/models/fixture-runner.ts#L690)

## Verification

| Check | Result |
|---|---|
| TypeScript build | Passed |
| Repository lint | Passed |
| Existing Phase 5 gate | 239 passed |
| Gate with the review regression | 239 passed, 1 failed |

Run `bash specs/047-model-qualification/gates/phase-05.sh` to reproduce. The test patch against `c779b492` is `.runs/review-regressions-phase05-20261123T203938Z-1f043bef.patch`.

All five tasks entered review open and share the failing gate. The direct finding belongs to T022. The workstation and hosted qualification records still await operator runs.
