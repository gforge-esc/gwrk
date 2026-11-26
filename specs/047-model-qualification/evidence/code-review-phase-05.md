# Phase 5 qualified routing review

NO-GO. The resolver accepts rejected or expired fallback evaluations. All five Phase 5 tasks remain open for the implementation owner.

## Verification

| Check | Result |
|---|---|
| TypeScript build | Passed |
| Repository lint | Passed |
| Original Phase 5 gate | 117 of 117 passed |
| Phase 5 gate with retained regressions | 7 failed, 117 passed |
| Synthetic runbook replay | Second promotion rejected |
| Live macOS and Linux qualification | Pending operator runs |

## Findings

- T021, fallback qualification. The resolver selected an implementation fallback after its evaluation rejected it for slower execution. It also selected a fallback evaluated against an expired fixture hash. Both bundles passed judge replay.
- T022, pin validation. Editing an active enforcement skill changed the selected instructions and left the model pin usable. A separate workflow dispatch accepted lock schema version 2. The store supports version 1. The public `define spec` command also rejected `--route provider-default` before it could bypass an unreadable pin.
- T023, workflow dispatch. A project without a lock or model override sent a backend request without the provider-default route label.
- T024, run manifests. The same default on `define spec` produced a manifest with the requested and observed identities. It omitted `routeMode`.
- T025, live runbook. Two roles passed evaluation against the same runner lock. Promoting the first changed its digest. The second promotion returned `incumbent-changed`. Evaluate and promote each role before evaluating the next. The Linux examples also need the service wrapper’s credential-file environment.

The task ledger records each source location and repair. The gate exercises the seven routing regressions. The separate runbook probe shows the documented sequence against the existing promotion check.

Regression patch against `f1b87ba3` is `.runs/review-regressions-phase05-20261123T200627Z-de181462.patch`.

Runbook reproduction patch is `.runs/runbook-reproduction-phase05-20261123T200627Z-de181462.patch`.
