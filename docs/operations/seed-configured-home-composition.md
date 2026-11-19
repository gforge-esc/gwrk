# Seed configured home composition

The readiness merge retains the prepared atomic seed writer. Its destination still follows the reviewed global path resolver. The incoming seed preparation used the operating system home directly and would ignore the hosted runner's configured gwrk home.

An isolated regression runs the incoming seed implementation with a temporary fallback home. It fails to populate the configured destination. The composed implementation passes that case. All writes in the regression remain inside temporary directories.

Readiness passes 83 checks with one existing skip. The seed phase gate passes 45 checks. The lock reader passes 17. The source linter passes 410 files. The focused configured-home run passes 12 checks after the temporary fallback assertion is added.

Logs are `/tmp/gwrk-integration-governance-readiness-and-seed-green.log` and `/tmp/gwrk-integration-seed-configured-home-red.log`. The corrected focused run is `/tmp/gwrk-integration-seed-configured-home-green.log`.

Before governance Phase 4 clearance, carry `specs/045-workflow-governance/evidence/seed-gwrk-home-integration.patch` into its feature worktree. The patch requires `src/adapters/config/paths.ts` and `src/domain/gwrk-paths.ts`. Reuse those files from reviewed Linux packaging head `a00007fb` if they are absent. This keeps the feature compatible without introducing another path resolver. Re-run its seed gate before independent review.

The seed implementation and policy lock reader remain prepared work. These composition checks do not clear governance Phases 3 or 4. Final full-suite and Linux checks remain required.
