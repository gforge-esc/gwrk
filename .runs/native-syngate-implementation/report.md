# Native Scenario B SYN gate implementation report

The Scenario B synchronize (SYN) gate fixture passes all unprivileged behavioral tests. Blocked: none.

## Artifact digests

| File path | Purpose | Artifact hash |
|---|---|---|
| tests/hosted-pilot/fixtures/syn-gate-policy.mjs | Pure policy core | b323512112c6b1688618ac6c7b9da2d3179be10dbbb6eaa933825a90c146308d |
| tests/hosted-pilot/fixtures/syn-gate-helper.sh | Outer helper script | 83779e7133397210447248ed2100fff5c3d2c155718ffde536928a5a7c36aca8 |
| tests/hosted-pilot/fixtures/syn-gate-client.mjs | Controller client | d6b0424ac22aef9a5e48dacb2a591b1c68791f99d35591b6607a05336836fb55 |
| tests/hosted-pilot/fixtures/nested-lifecycle.mjs | Lifecycle verification | e08fe6b64f8c11dd3e515e2d135102ab3c7e1d6646558ec9834797f58042936c |
| tests/hosted-pilot/fixtures/syn-gate.test.mjs | Behavioral test suite | f1e5ac211ab2ba9b66b3e23f6d27fb823bc48eda4362175e186ffc4e7353a552 |

## Capability gates

| Capability gate | Verification target | Target threshold | Verdict |
|---|---|---|---|
| Network isolation (CAP-02) | Reject identical host and outer network namespace | Exit non-zero on identical inode | Pass |
| Policy validation (CAP-03) | Validate runId, single opId, and bound ttlMs | Rejects ttlMs above 1000 ms | Pass |
| Helper lifecycle (CAP-04) | Fail closed on lock, clean up on deadline or signal | Remove duration under 1000 ms | Pass |
| Causal proof (CAP-05) | Reject armed origin traffic and verify reuse | Zero origin HTTP requests | Pass |

## Coordinator constraints

The implementation satisfies five coordinator corrections:

1. Lock waiting omitted. The helper omits iptables lock waiting completely. A busy lock fails closed immediately.
2. Remaining monotonic deadline. Monotonic uptime bounds every operation. The helper reads uptime from the system file.
3. Independent expiry. An autonomous timeout path deletes the rule when the client stalls.
4. Measured duration receipts. The receipt records operation timings. Removal exceeding 1000 ms fails verification.
5. Hardcoded single rule. The implementation hardcodes the exact loopback drop rule on the INPUT chain. It rejects table flushes and arbitrary strings.

## Execution evidence

```
[RED state]
FAIL tests/hosted-pilot/fixtures/syn-gate.test.mjs
Error: Cannot find module './syn-gate-client.mjs'
Test Files: 1 failed (1)

[GREEN state]
RUN v3.2.4
✓ tests/hosted-pilot/fixtures/syn-gate.test.mjs (19 tests) 1121ms
✓ tests/hosted-pilot/fixtures/nested-lifecycle.test.mjs (20 tests) 2765ms
Test Files: 14 passed (14)
Tests: 158 passed (158)
Biome: Checked 33 files. 0 errors.
TypeScript: tsc build clean.
```
