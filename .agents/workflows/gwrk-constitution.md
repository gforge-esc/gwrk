---
description: Create or update the project constitution for governance and principles.
---

# Workflow: Constitution

This workflow creates or updates the project constitution at `.specify/memory/constitution.md`. The constitution defines non-negotiable principles that govern all specifications and implementations.

<scope_constraints>
- Create or update ONLY `.specify/memory/constitution.md`.
- Do not modify spec.md, plan.md, or any other artifact.
- Every principle MUST be declarative and testable (not aspirational prose).
- Amendment requires version bump and changelog entry.
</scope_constraints>

The constitution is a governance document containing:
- Project principles (MUST/SHOULD rules)
- Quality standards
- Compliance requirements
- Amendment procedures

## Prerequisites
- None for creation.
- For updates: existing `.specify/memory/constitution.md`.

## Steps

1.  **Load Existing Constitution** (if exists):
    - Read `.specify/memory/constitution.md`
    - Identify placeholder tokens: `[ALL_CAPS_IDENTIFIER]`

2.  **Collect/Derive Values**:
    - From user input (conversation)
    - From repo context (README, docs)
    - **Dates**:
      - `RATIFICATION_DATE`: Original adoption date
      - `LAST_AMENDED_DATE`: Today if changes made
    - **Version**: Semantic versioning (MAJOR.MINOR.PATCH)
      - MAJOR: Principle removals or redefinitions
      - MINOR: New principle added
      - PATCH: Clarifications, typo fixes

3.  **Draft Constitution**:
    - Replace all placeholders with concrete text
    - Each Principle section needs:
      - Succinct name
      - Non-negotiable rules (MUST/SHOULD)
      - Explicit rationale
    - Governance section: amendment procedure, versioning policy

4.  **Consistency Propagation**:
    - Check `.specify/templates/plan-template.md` for Constitution Check alignment
    - Check `.specify/templates/spec-template.md` for mandatory sections
    - Check `.specify/templates/tasks-template.md` for principle-driven task types

5.  **Produce Sync Impact Report** (as HTML comment at top):
    ```markdown
    <!--
    Version change: 1.0.0 → 1.1.0
    Modified principles: [list]
    Added sections: [list]
    Removed sections: [list]
    Templates requiring updates:
    - ✅ plan-template.md (updated)
    - ⚠ spec-template.md (pending)
    -->
    ```

6.  **Validation**:
    - No unexplained bracket tokens
    - Dates in ISO format (YYYY-MM-DD)
    - Principles are declarative and testable

7.  **Write Constitution**: Save to `.specify/memory/constitution.md`.

8.  **Report**:
    - New version and bump rationale
    - Files flagged for follow-up
    - Suggested commit message

## Example Principles

```markdown
## Principle 1: Fail Fast

Applications MUST crash immediately if required configuration is missing.
Graceful defaults (e.g., `process.env.PORT || 3000`) are PROHIBITED.

**Rationale**: Silent failures lead to debugging nightmares. Explicit
crashes surface configuration problems at startup, not in production.

## Principle 2: No Magic Values

All configuration values MUST flow from `.env` → `docker-compose` → application.
Hardcoded values in application code are PROHIBITED.

**Rationale**: Single source of truth for configuration prevents drift
between environments.
```

## Example Usage
> "Create a constitution with principles for fail-fast and observability"
> "Update the constitution to add a new security principle"

<quality_gate>
Before reporting, verify:
- No unexplained bracket tokens in the constitution
- All dates in ISO format (YYYY-MM-DD)
- Every principle is declarative and testable
- Version bump rationale is documented
- Sync Impact Report is present as HTML comment
</quality_gate>

## Anti-Patterns

- ❌ Writing aspirational prose instead of testable principles
- ❌ Skipping consistency propagation to templates
- ❌ Omitting the Sync Impact Report
- ❌ Modifying spec or plan files (those are separate workflows)
