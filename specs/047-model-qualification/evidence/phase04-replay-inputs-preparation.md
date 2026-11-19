# Replay inputs preparation

Evaluation results now include the normalized gate and judge evidence needed by promotion. The persisted form carries comparison repeat checks and citation sets with both structured verdicts. The existing secret guard checks the assembled result before export. The blinding secret remains absent.

The new regression failed because evaluation returned no replay inputs. It now passes after a JSON round trip. Replaying a split verdict fails. Replaying a failed deterministic gate also fails. The build and 616 composition checks pass with the source linter.

The logs are `/tmp/gwrk-model-phase4-replay-evidence-red.log` and `/tmp/gwrk-model-phase4-replay-evidence-green.log`.

This preparation does not implement promotion or clear Phase 4. Promotion must also revalidate role timing and required handoffs. It must compare current fingerprints and runner scope before the incumbent-digest guarded write. The saved decision boolean cannot authorize promotion. The gate still requires the missing CLI tests.
