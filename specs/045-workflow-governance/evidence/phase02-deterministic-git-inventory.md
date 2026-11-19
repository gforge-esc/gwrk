Assessment inventory fixes Git pathspec semantics for its explicit glob. Independent clearance remains required.

Three inherited-environment cases failed before repair. The subprocess now disables inherited literal and glob controls. It also disables inherited case-insensitive matching. The explicit assessment glob remains active. Prior raw-byte target hashing and the filtered large-index inventory remain intact.

The phase gate passes 73 cases with one existing skip. Verification logs remain in the private checksum archive. Their source names are `/tmp/gwrk-045-inherited-pathspec-controls-red.log` and `/tmp/gwrk-045-inherited-pathspec-controls-green.log`. Earlier findings remain in `.gwrk/review-history/phase-02-through-2026-11-19T0034Z.json`.
