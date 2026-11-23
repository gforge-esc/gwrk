# Phase 5 selected review workflows

NO-GO for `a6b4ba07`. The model qualification owner must fix two defects in T022 before acceptance review.

## Project-only review workflow

The project selected `project-code-review` and the runtime rendered its template. Qualification then reported `Plugin 'project-code-review' not found.` The fingerprint calculation looked for the selected workflow in the temporary fixture project. Resolve the template in the project that selected it and render it with synthetic inputs. [Regression test](../../../src/application/models/resolve-route.test.ts#L906)

## Review instructions from the strategy manifest

The tests changed one active step description in the selected CLI strategy. The selector returned the revised instructions for both code and acceptance review. In each case the resolver still returned a qualified route. Ship includes those descriptions in the review prompt. Include the ordered active instructions for each stage in its fingerprint. [Regression tests](../../../src/application/models/resolve-route.test.ts#L950)

## Reproduction

Run `bash specs/047-model-qualification/gates/phase-05.sh`. The regression patch against `a6b4ba07` is `.runs/review-regressions-phase05-20261123T211308Z-1caebf82.patch`.

The build and repository lint passed. All 243 existing Phase 5 checks passed in both gate runs. The expanded gate exited 1 on the three new cases. All five tasks entered review open and share that gate. T022 carries both direct findings.
