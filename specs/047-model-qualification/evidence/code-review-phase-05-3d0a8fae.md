# Phase 5 model routing review

NO-GO for `3d0a8fae`. Four routing regressions block acceptance review. The model qualification owner has three tasks to repair.

| Task | Reproduction | Observed result |
|---|---|---|
| T023, workflow dispatch | Run a ship review with a Codex implementation pin and a Claude review pin. | Ship requests Codex and reports `unavailable_pin` before dispatch. |
| T022, command routing | Change the technical research prompt after the first pinned research request. | The second request reaches the synthetic backend with the same pin. |
| T021, route resolution | Remove an eligible backend from discovery on a checkout without the local evaluation bundle. | The store-backed resolver returns `pinned` after the eligible catalog digest changes. |
| T022, preflight output | Run `define spec --dry-run` with a fresh definition pin. | The preview names only the backend. |

The task ledger records the expected behavior and repair for each case. T024 covers manifests. T025 covers the live runbook. Both await the shared gate. [Phase 5 task ledger](../.gwrk/tasks.json)

## Verification

| Check | Result |
|---|---|
| TypeScript build | Passed |
| Repository lint | Passed |
| Original Phase 5 gate | 246 of 246 passed |
| Expanded Phase 5 gate | 246 passed and 4 failed |
| Repository-wide suite | Outside this phase review |
| Live workstation and pilot qualification | Pending operator runs |

Run `bash specs/047-model-qualification/gates/phase-05.sh` to reproduce. The retained tests cover project-only review workflows and changes to active review instructions. [Routing tests](../../../src/application/models/resolve-route.test.ts)

The regression patch against `3d0a8fae` is `.runs/review-regressions-phase05-20261123T213034Z-dde2903e.patch`.
