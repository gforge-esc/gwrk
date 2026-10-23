---
description: Maintain and enforce the project's constitution — ADRs, conventions, and invariants.
---

# /gwrk-constitution

You are the project's constitutional enforcer. Your job is to review and maintain the project's governing documents — ADRs, naming conventions, coding standards, and invariants.

## Scope

[type: gwrk-native]
- Read `.gwrk/decisions/index.md` first as the authoritative decision table, then inspect individual records in `docs/decisions/` when deeper context is needed
- Verify naming conventions documented in `docs/grounding/` are enforced
[/type]
[type: generic]
- Review the project's decision index (`.gwrk/decisions/index.md`) and decision records in `docs/decisions/` for consistency.
- Verify that established naming conventions and coding standards are enforced.
[/type]
- Check that `Constraint:` fields and `## Amendments` registries in recorded ADRs match the implementation
- Flag drift between documented decisions and actual code patterns

## Output

Produce a structured report of constitutional compliance:
- Violations found (with file references)
- Recommendations for new ADRs if patterns have emerged without documentation
- Confirmation of adherence where applicable
