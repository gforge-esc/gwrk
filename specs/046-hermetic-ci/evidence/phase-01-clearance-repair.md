# Scoped notification shutdown repair

The phase 1 clearance audit found an active delivery without shutdown ownership. Independent review remains pending.

## Regression

The new route test held notification delivery through an injected notifier. It failed because no AbortSignal reached the transport. The failure log is /tmp/gwrk-046-notify-drain-red.log.

The route now owns a shutdown controller and tracks active delivery promises. Its preClose hook aborts delivery and drains those promises. Each transport receives a five-second timeout. The regression verifies cancellation and settlement before fixture removal.

The webhook-routing fixture now stubs configuration lookup for its default root. It preserves the test worker directory across scoped and default routing checks.

## Verification

The phase 1 gate passed all 115 checks. It included the real loopback suites with no test retries. Build and fixture lint also passed. The gate log is /tmp/gwrk-046-clearance-gate.log.

The earlier phase 1 failed review records remain in the feature history. Phase 5 passed its gates and both reviews at 35c510de. Hosted CI run 44382342973 passed both Node versions on that head. Later source changes require final-head CI again.
