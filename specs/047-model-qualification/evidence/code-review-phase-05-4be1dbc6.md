# Phase 5 routing repair review

NO-GO for implementation `4be1dbc6`. The model qualification owner must fix two defects in T022 before Phase 5 can advance.

| Check | Result |
|---|---|
| TypeScript build | Passed |
| Repository lint | Passed |
| Original Phase 5 gate | 237 passed |
| Expanded Phase 5 gate | 237 passed and 2 failed |
| Live workstation and hosted qualification | Pending operator runs |

## Blocking findings

1. Changed workflow prompt. A pinned specification request used the project’s `gwrk-specify` override. Editing its `PROMPT.md` still allowed a second backend call. The fixture runner hashes the workflow from a temporary project. Resolve the effective template from the dispatch project when computing its fingerprint. [Fixture runner](../../../src/adapters/models/fixture-runner.ts#L648)
2. Unreadable fallback evidence. A fresh primary pin resolved until an unselected fallback’s bundle contained malformed JSON. The next request threw `SyntaxError`. Isolate each fallback read so the primary stays usable and an explicitly requested unqualified backend reports `unavailable_pin`. [Command resolver](../../../src/utils/resolve-agent.ts#L281)

## Clearance

The earlier routing regressions passed. Synthetic promotion rejected the stale evaluation and accepted sequential role promotions. The hosted example uses the service credential loader.

All five tasks entered review open and use the same gate. The direct findings belong to T022. The other four tasks await a passing shared gate.

Regression patch against `4be1dbc6` is `.runs/review-regressions-phase05-20261123T202611Z-79777da2.patch`. Reproduce both failures with `bash specs/047-model-qualification/gates/phase-05.sh`. [Retained tests](../../../src/application/models/resolve-route.test.ts#L802)
