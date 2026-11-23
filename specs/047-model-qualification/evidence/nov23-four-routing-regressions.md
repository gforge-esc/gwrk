# Model routing repair handoff

Repair the four retained routing regressions from review `140a7d97`. Blocked: the Phase 5 shared gate and independent reviews remain open. Preserve all completed qualification work and its review history.

The parent includes the reviewed workflow hash repairs. It also includes the passing integration CI fixture fixes from `4cb8dea3`. Do not restart earlier phases. Do not change production model pins or run live inference qualifications.

## Reproduced defects

1. Ship selects the implementation backend for a review dispatch. A fresh review-role pin on another backend then fails before dispatch. Resolve each role through its qualified route. Preserve explicit user overrides and the provider-default escape. Forward the selected backend and model with effort and route mode.
2. The active technical research methodology prompt can change without expiring its research pin. Hash the effective prompts used by research. Preserve project overrides and selected review workflow hashing. Keep fixture inputs synthetic while resolving templates from their owning project.
3. A store-backed pin remains fresh after the eligible catalog changes when its local evaluation bundle is absent. Preserve enough pinned evidence to detect catalog drift. Fail with a diagnostic when freshness cannot be established. Keep already promoted lock compatibility explicit. Never silently accept missing evidence as fresh.
4. `define spec --dry-run` reports a backend but omits the qualified model and effort. Render the resolved route without inference. Preserve provider-default and stale-pin diagnostics.

## Evidence and gates

All four tests are committed in `src/application/models/resolve-route.test.ts`. They are included by `gates/phase-05.sh`. The coordinator reran their names against the composed parent. All four fail before production changes. The log is `/tmp/gwrk-nov23-model5-four-routing-red.log`.

The review report is `code-review-phase-05-3d0a8fae.md` in this directory. Preserve its test cases. Run those cases before editing production code. Add a behavioral case for each additional verified root cause before repair. Run the complete Phase 5 gate and full suite after repair. Require independent code and acceptance clearance on the resulting head. Do not treat the four known baseline failures as an allowed final result.

Keep architecture and language guidance aligned. Initialization must make no inference calls. Existing projects receive desired context without a conformance claim. No deployment or live enrollment belongs to this repair.
