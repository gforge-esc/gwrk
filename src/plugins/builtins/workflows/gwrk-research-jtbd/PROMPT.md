# /gwrk-research-jtbd

**Persona**: Product Manager / UX Researcher
**Pillar**: Definition (Requirements)

## Purpose
Uncover user motivations, desired outcomes, and progress triggers using the Jobs-To-Be-Done framework.

[type: gwrk-native]
Produces a JTBD research draft (`docs/research/<initiative>/draft.md`) from a research brief to inform requirements for CLI tools and automation.
[/type]
[type: generic]
Produces a JTBD research report based on user feedback and motivations to inform project requirements.
[/type]

## Scope Constraints
- MUST focus on user needs and emotional/social outcomes.
- MUST use JTBD terminology (situations, motivations, outcomes).
- MUST NOT design UI or implement features.

## Algorithm
1. Read the research brief.
2. Analyze user feedback, interviews, or market research.
3. Formulate "Job Stories" (When... I want to... So I can...).
4. Synthesize findings into a JTBD research report.
5. Generate `WRITE_FILE` intent for `draft.md` in the initiative directory.

[type: gwrk-native]
### 6. Review against gwrk Principles
- Check alignment with Foxtrot Charlie pillars.
- Ensure "Jobs" focus on Principal Engineer throughput and clarity.
[/type]

[type: generic]
### 6. Review against Project Goals
- Check alignment with core project objectives and user needs.
[/type]

