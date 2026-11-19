# Qualification judge policy repair

Reject missing judge policy and unavailable judge routes before inference. Two hermetic regressions fail against the prepared CLI. Blocked: repair and independent clearance.

The failing cases use the synthetic catalog and runner injection. Both return exit zero when they must fail. The retained log is `/tmp/gwrk-model-judge-availability-root-red.log`. The tests are committed at `df0b5fa9` and merged into this preparation checkout.

Use two explicit judges or the active pinned judge pair. Validate each route against the current runner catalog. Require provider and family independence. Reject missing policy with a configuration hint. Remove the implicit legacy model pair. Do not replace it with another hardcoded pair.

Preserve all Phase 4 promotion revalidation and CLI lifecycle work. The obsolete enforcement baseline fixture is fixed in parent commit `b1af540c`. Code review was interrupted at the quota handoff. It is not a clearance. Re-run only this phase with bounded attempts.
