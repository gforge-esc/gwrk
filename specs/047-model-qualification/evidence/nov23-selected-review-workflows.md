# Selected review workflow freshness

The review fingerprint now includes the project's selected code and acceptance review workflows. Blocked: fresh independent phase clearance remains required.

Review commit `35eb26f9` retains the failing CLI review case. The regression matrix expands it to CLI and webapp projects. Each strategy checks both code review and acceptance review. All four cases fail before repair because an edited selected prompt still reaches the backend. Evidence is `/tmp/gwrk-nov23-model5-review-selection-matrix-red.log`.

Fingerprint selection uses `resolveReviewPlugin`, the same project selector as ship dispatch. It retains the generic synthetic review fixture. It also hashes the selected code and acceptance templates with their synthetic renderings. The shared review digest records workflow identifiers and hashes. A selected workflow change therefore requires requalification.

The existing governance hash fixture now declares a project configuration. Its governance-change assertions remain intact. No production fallback bypasses project review selection.

All 141 targeted routing and fixture checks pass. Evidence is `/tmp/gwrk-nov23-model5-review-selection-matrix-green-2.log`. Build and lint also pass. Qualification inference still uses synthetic fixture inputs. This repair performs no live model promotion.

The parent includes runner repair `b34a6b1d`. Incomplete execution cannot count as a passing baseline. Fresh clearance must have zero full-suite failures. Preserve all existing phase work and review history. Use the shared Phase 5 gate before independent code and acceptance review.
