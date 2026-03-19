---
description: Create an implementation plan from a feature spec
---

# /plan

**Persona**: Senior Architect
**Pillar**: Definition (Architecture)

<scope_constraints>
- Generates an implementation plan based on `spec.md`.
- Output MUST be written directly to `{feature_dir}/plan.md`, entirely replacing the file if it exists.
- DO NOT save the plan text to a temporary or sandbox directory (like `.gemini/tmp` or `.runs`). It must be written directly to the host project directory.
- The plan MUST strictly adhere to the standardized gwrk architecture plan template. Generic markdown plans will break downstream tasks like `/plan-to-tasks`.
</scope_constraints>

## Purpose
Analyzes the feature specification (`spec.md`) and designs a concrete, phased implementation plan that strictly adheres to the gwrk structural standards so it can be parsed by `define tasks`.

## Inputs
- `feature_dir`: Path to the feature directory (e.g., `specs/005-parallel-dispatch`)

## Prerequisites
- `{feature_dir}/spec.md` exists and is deeply understood.

## Steps

### 1. Read the Specification
Read `{feature_dir}/spec.md` thoroughly. Understand the objectives, requirements, coverage matrix constraints, and test scenarios.

### 2. Design the Architecture & Phases
Break down the implementation into logical, sequential phases. You must identify specific files, requirements addressed, dependencies, and contract mappings for each phase.

### 3. Draft the Plan
You MUST use the exact following markdown structure for the plan. Do not deviate from these headers:

```markdown
# Implementation Plan: {Feature Name}

**Branch**: `{branch-name}` | **Date**: {YYYY-MM-DD} | **Spec**: [spec.md](./spec.md)

## Summary
Brief summary of the plan.

---

## Phases and File Structure

### Phase 1: {Phase Name}
{Description of phase}

**Files (N):**
- `src/path/to/file.ts` (CREATE/MODIFY: {Detailed instruction})

**Requirements Addressed**: FR-001, US-001, etc.
**Dependencies**: None
**Contract Mapping**:
- `specs/{feature}/contracts/{name}.md` -> `methodName` -> `src/path/file.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| .agents/rules/coding-style.md | {Reason} |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | Unit/E2E | `src/path/file.test.ts` | {Assertion logic} |

#### Done When
- `npm test src/path/file.test.ts` exits 0

### Phase 2: ... (Repeat structure for all phases)

---

## Type Dependency Graph
| Shared Type | Defined In | Consumed By |
|---|---|---|
| {TypeName} | `src/path` | `src/other` |

---

## Mockup-to-Selector Mapping
{Map elements if UI feature, or "_No mockups exist for this feature._"}

---

## Deferred Items
| Spec Item | Title | Reason | Target |
|---|---|---|---|
| {ID} | {Title} | {Reason} | {Future} |

---

## Coverage Matrix
| Spec Item | Phase | Status |
|---|---|---|
| FR-001 | 1 | PLANNED |
| US-001 | 1 | PLANNED |
```

### 4. Write the Plan File
**MANDATORY:** Write the drafted markdown content directly to `{feature_dir}/plan.md`. If the file already exists, overwrite it completely. **DO NOT output it to a temporary environment.**

### 5. Report
Notify the user that the highly-structured gwrk plan has been written to `{feature_dir}/plan.md` and display a summary of the Coverage Matrix.