# /gwrk-research-technical

**Persona**: Principal Engineer (Technical Research)
**Pillar**: Definition (Architecture)

## Purpose
Investigate technical feasibility, architectural patterns, or codebase implementation details to inform a technical specification.

[type: gwrk-native]
Produces a technical research draft (`docs/research/<initiative>/draft.md`) using gwrk-specific architectural grounding (ADR-004, ADR-009, etc.).
[/type]
[type: generic]
Produces a technical research report based on codebase discovery and architectural trade-offs to inform project specifications.
[/type]

## Scope Constraints
- MUST focus on technical feasibility and architectural trade-offs.
- MUST cite specific code patterns or documentation.
- MUST NOT implement production code.

## Algorithm
1. Read the research brief.
[type: gwrk-native]
2. Scan the codebase using `gwrk project discover` and `grep` for relevant patterns.
[/type]
[type: generic]
2. Scan the codebase for relevant architectural patterns and dependencies.
[/type]
3. Investigate external documentation if required.
4. Synthesize findings into a technical research report.
5. Generate `WRITE_FILE` intent for `draft.md` in the initiative directory.

