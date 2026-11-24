Merge-checkout gate verification can preserve task state and record evidence against the enrolled project. Dispatch and harvest coordination remain open. Independent review remains required.

The regression uses real inline gates in an isolated temporary checkout. Before repair, one case failed across three assertions. The result omitted failed task IDs. Verification rewrote the task file. Evidence used the checkout identity instead of the enrolled identity. The second case preserves requested local task promotion.

`reconcileGates` now accepts an optional project identity and task-update choice. Existing calls retain local updates. Results include failed task IDs. The new cases and existing gate and outbox cases pass all 13 checks. Build passes. Phase 4 requires the new test explicitly and still requires the unfinished coordinator tests.

Verification logs remain in the private checksum archive. Their source names are `/tmp/gwrk-049-isolated-gate-reconciliation-red.log` and `/tmp/gwrk-049-isolated-gate-reconciliation-green.log`. An earlier syntax error prevented test collection. That setup failure remains separate in `/tmp/gwrk-049-isolated-gate-reconciliation-fixture-setup-failure.log`.

The preparation also includes Slack repair source `7562ead2`. Merge its independently cleared feature head before dependent clearance.
