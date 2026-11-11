---
name: gwrk-assess
description: Assess an existing repository against its declared gwrk architecture target and propose ordered feature specs. Use for architecture assessment or migration planning. Does not implement repairs or certify conformance.
---

# Architecture assessment

Assess the current repository against its chosen design. Produce source-backed findings and stepwise feature proposals. Blocked: none when project context is available.

Read [assessment.md](references/assessment.md) for the assessment contract and output fields.

Read `.gwrk/architecture.md` first. Read `.gwrk/decisions/index.md` and the configured decision corpus. Read project agent instructions. Existing Decided records retain authority. Proposed targets describe desired changes and do not prove code conformance.

Inspect runtime code and dependency boundaries across the repository. Check the architecture tests themselves for omissions. Check functional-core purity and explicit state. Inspect language and framework integration. Inspect test-driven development evidence and delivery gates.

Cite concrete source paths and one-based lines. Separate source observations from executed check results. Report uninspected scope and uncertain conclusions. Run bounded read-only checks when useful. Do not infer broad compliance from narrow tests.

Group findings into logical features with dependency ordering. Each proposed spec needs changes and acceptance criteria that prove movement toward the target. Include regression safety for behavior-preserving migration. Cover every finding or explain its deferral.

When a prior gap map is supplied, reconcile each prior gap with current evidence. Use one status per gap. Choose confirmed or resolved when evidence supports it. Otherwise choose revised or unassessed. Preserve that map as reference. Do not assume its claims remain true.

Preserve source and task state. Preserve project decisions and configuration. Do not commit or contact anyone. Write only the requested assessment artifacts when running as a standalone skill. Under the gwrk workflow contract, return JSON only and leave all artifact writes to gwrk.

The same skill runs in any host that reads SKILL.md. Supported packages cover Claude and Codex. Gemini uses the extension manifest. Use the host's available file and command tools. Do not invoke `gwrk assess` from this skill.
