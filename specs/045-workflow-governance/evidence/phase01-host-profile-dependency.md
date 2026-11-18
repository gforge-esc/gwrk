Recognized language manifests take precedence over the legacy architecture-document fallback. Blocked: reviewed architecture policy phase 3 must be integrated before governance clearance.

Four captured dispatch regressions failed after the previous attempt. Rust and Go fixtures received TypeScript profiles when `docs/architecture.md` existed. Python fixtures received the repository-specific gwrk conventions policy.

The detector fallback now applies only when no language manifest signal exists. Actual gwrk package self-detection remains first. The docs-only fallback remains available. Rust and Go dispatch regressions now pass.

The two Python policy exclusions remain failing until feature 044's project-scoped policy selection is integrated. Do not dispatch another governance repair before that dependency clears.

The failing evidence is `/tmp/gwrk-045-host-manifest-precedence-red.log`. The partial verification is `/tmp/gwrk-045-host-manifest-precedence-partial-green.log`.
