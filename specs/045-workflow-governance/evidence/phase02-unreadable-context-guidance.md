Discovery suppresses the init hint when a managed input is unreadable. Independent clearance remains required.

The reviewer found a directory at the context manifest path. Initialization could not repair it. Three compiled CLI regressions extend that case to the architecture target and decision index. All three failed before repair. The guard now suppresses the init hint for any unreadable managed input. It still suggests init for missing context with a readable or absent manifest. Invalid manifests retain their earlier guard.

The phase gate passes 68 cases with one existing skip. Verification logs remain in the private checksum archive. Their source names are `/tmp/gwrk-045-unreadable-context-guidance-red.log` and `/tmp/gwrk-045-unreadable-context-guidance-green.log`. Earlier findings remain in `.gwrk/review-history/phase-02-through-2026-11-19T0009Z.json`.
