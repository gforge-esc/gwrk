# Coordinator implementation handoff

Implement dispatch and harvest coordination against the approved operations ports. Preserve the prepared outbox and isolated gate adapter work. Blocked: independent phase clearance remains required.

The parent at `9a23d8c6` composes cleared durable adapters and Slack Phase 3. Build and lint pass. The five-file composition suite passes 114 checks. Durable adapter Phase 3 cleared at `679c6825` with both CI jobs passing in run 44447926701.

Use `contracts/coordinators-routes-and-cli.md` as the application interface contract. Preserve acceptance-before-acknowledgement and lease fencing. Confirm recovered worker state before any relaunch. Initialize the complete harvest stage plan before effects. Keep stage receipts scoped to the verified project and operation. Keep unknown delivery outcomes uncertain until reconciliation confirms absence.

The combined candidate separately preserves Linux readiness cancellation in durable transport. Its integration note is `docs/operations/durable-bounded-delivery-composition.md` at core integration commit `a4fd5b54`. Carry that composition before durable server ingress Phase 5. Do not replace its bounded transport with the older adapter implementation.

Write real behavioral coordinator tests before production changes. Retain failed runs and review patches. Live deployment and project enrollment remain outside this implementation phase.
