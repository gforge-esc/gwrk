---
description: Create or refine a feature specification (spec.md)
---

# /specify

**Persona**: Product Manager + Senior Architect
**Pillar**: Definition (Clarity)

<scope_constraints>
- Generates or updates a feature specification based on user input or research.
- Output MUST be written directly to `{feature_dir}/spec.md`, entirely replacing the file if it exists.
- DO NOT save the text to a temporary or sandbox directory (like `.gemini/tmp`). It must be written directly to the host project directory.
- The output MUST strictly adhere to the standardized gwrk specification template.
</scope_constraints>

## Purpose
Defines the functional requirements, user scenarios, constraints, and success criteria for a feature, resulting in the foundational `spec.md` document used by all downstream execution tasks.

## Inputs
- `feature_dir`: Path to the feature directory (e.g., `specs/005-parallel-dispatch`)
- Context or prompt provided by the user.

## Steps

### 1. Read the Context
Understand the objective for the feature. If an existing `spec.md` is present, read it to refine and update its contents.

### 2. Draft the Specification
You MUST use the exact following markdown structure for the specification. Do not deviate from these headers:

```markdown
# Feature Specification: {Feature Name}

**Feature Branch**: `{branch-name}`
**Created**: {YYYY-MM-DD}
**Status**: {Draft | In Review | Settled}
**Input**: {Brief description of inputs/research}

---

## 2. User Scenarios & Testing
*Detail scenarios from the user perspective.*

### US-001 - {Scenario Title} (Priority: P0|P1|P2)
As a {Persona}, I want {action}, so that {value}.
**Implements**: FR-001
**Independent Test**: {High-level test description}
**Acceptance Scenarios**:
1. **Given** {condition}, **When** {action}, **Then** {result}

---

## 3. Roles, Scopes & Permissions
*List specific RBAC roles or state "Leverages shared RBAC. No feature-specific roles. See RP-000."*

---

## 4. Functional Requirements
*List specific functional requirements using FR-### format.*
- **FR-001**: System MUST {requirement}. (Implements: US-001)

#### FR-001 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| {Condition} | `{Error Message}` | 1 |

---

## 5. Data Model Requirements
*Define schemas, tables, and interfaces using DM-### format.*

### DM-001: {Model Name}
```typescript
interface Sample {
  id: string;
}
```

---

## 6. Technical Constraints
*List strict technical boundaries using TC-### format.*
- **TC-001**: {Constraint definition}

---

## 7. Testing Requirements
*Define unit and integration test strategies using TR-### format.*
- **TR-001**: `src/path/file.test.ts` — {Strategy Description}. (FR-001)

---

## 8. Success Criteria
*List business/technical success metrics using SC-### format.*
- **SC-001**: {Criteria definition}

---

## 9. Verification Requirements
*List manual or automated end-to-end verification steps using VR-### format.*
- **VR-001**: {Verification definition}

---

## 10. Coverage Matrix
| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| US-001 | FR-001 | FR-001 | US-001 | TR-001 |
```

### 3. Write the File
**MANDATORY:** Write the drafted markdown content directly to `{feature_dir}/spec.md`. If the file already exists, overwrite it completely. **DO NOT output it to a temporary environment.**

### 4. Report
Notify the user that the specification has been written to `{feature_dir}/spec.md` and display a brief summary of the changes.