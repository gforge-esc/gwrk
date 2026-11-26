# Phase 2 database test repair

The patch closes the two database coverage gaps identified before Phase 2 implementation. The adapter module is still absent. Its regression suite cannot execute until implementation exists.

## Changes

The creation case injects a SQLite trigger failure during the second valid enrolled grant insertion. The trigger detects a prior binding for the new credential. It permits either project insertion order. After reopen, the test requires no credential or associated bindings. Both enrolled projects must remain present. Existing invalid-input and rotation failure cases remain intact.

The session case starts an independent Node process with its own SQLite connection. An explicit ready message precedes parent transaction writes. The parent holds an uncommitted insert while the child attempts observation. SQLite busy or locked errors are acceptable. A fresh operation after commit must retain the original cap.

The parent then holds an uncommitted revocation while the child observes. Authentication completed before revocation commits may remain valid. A fresh observation after commit must deny the revoked digest. Reopen confirms one row and the original cap plus persisted revocation.

The fixture sets a short SQLite busy timeout after adapter construction. IPC has a five-second deadline. Cleanup closes the child or kills it after its shutdown deadline. No automatic retry behavior is required from the adapter. The prior sequential two-connection checks remain unchanged apart from their description.

Receipts reside in `.runs/api-test-repair/` in the preparation worktree.

## Evidence

| Receipt | Result |
|---|---|
| `module-red.log` | RED: one failed file because auth-store module is absent |
| `raw-fixture-proof-final.log` | PASS: five raw SQLite harness checks |
| `build-final.log` | PASS |
| `lint-final.log` | PASS |

The module RED contains no collected tests. It does not prove that the future adapter passes these cases. The raw proof extracts the same child source and IPC helpers from the test file. It verifies lock contention and post-commit visibility using existing SQLite. Its creation check contrasts transactional rollback with a partial-write negative control. This proves the fixture can expose missing rollback. It does not substitute for the future adapter run.

## Environment

The first formatting command synchronized dependencies through a shared node_modules link. The private formatting log retains that uncontrolled dependency change. Tracked source outside this patch remained unchanged. The verifier package remained resolvable. This worktree now owns a private dependency directory.

No production code or frozen port changed. No deployment or live authentication occurred. Independent review and the implemented Phase 2 gate remain required.
