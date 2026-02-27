# Feature Specification: {{FEATURE_NUMBER}} {{FEATURE_NAME}}

**Feature Branch**: `{{BRANCH_NAME}}`
**Created**: {{DATE}}
**Status**: Draft
**Input**: {{FEATURE_DESCRIPTION}}

---

## 2. User Scenarios & Testing

### {{US_ID}} - {{US_TITLE}} (Priority: {{PRIORITY}})
{{US_DESCRIPTION}}

**Implements**: {{FR_REFS}}

**Independent Test**: {{INDEPENDENT_TEST}}

**Acceptance Scenarios**:
1. **Given** {{PRECONDITION}}, **When** {{ACTION}}, **Then**:
   - `{{ASSERTION_COMMAND}}` exits 0

<!-- Repeat US block for each user story -->

---

## 3. Roles, Scopes & Permissions

<!-- If no feature-specific roles: -->
_Leverages shared RBAC. No feature-specific roles. See RP-000._

<!-- If feature-specific roles exist, use RP-### identifiers -->

---

## 4. Functional Requirements

- **{{FR_ID}}**: System MUST {{REQUIREMENT}}. (Implements: {{US_REFS}})

<!-- Repeat for each FR -->

#### {{FR_ID}} Error States
<!-- MANDATORY for each FR with failure modes -->
| Condition | stderr contains | Exit code |
|---|---|---|
| {{CONDITION}} | {{STDERR_OUTPUT}} | {{EXIT_CODE}} |

---

## 5. Data Model Requirements

<!-- If no data entities: -->
_No database entities required for this feature. See DM-000._

<!-- If entities exist, use DM-### identifiers -->

---

## 6. Technical Constraints

- **TC-001**: Determinism — SHA256 input/output stability for all engine functions.
- **TC-002**: Air-Gapped — No external network calls at runtime. All assets vendored/bundled.
- **TC-003**: Fail-Fast Config — Zod validation with no `.default()` calls. Missing var → `process.exit(1)`.

<!-- Add feature-specific TCs as needed -->

---

## 7. Testing Requirements

<!-- MUST be feature-specific. Name target file/module + what to assert. -->
- **{{TR_ID}}**: `{{TARGET_FILE}}` — {{TEST_DESCRIPTION}}. {{TEST_FRAMEWORK}}. ({{FR_REF}})

<!-- If a test type doesn't apply: -->
- **{{TR_ID}}**: DEFERRED — {{RATIONALE}}

---

## 8. Success Criteria

- **{{SC_ID}}**: {{MEASURABLE_OUTCOME}}

---

## 9. Verification Requirements

- **{{VR_ID}}**: {{VERIFICATION_STEP}}

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| {{US_ID}} | {{FR_REFS}} | {{FR_ID}} | {{US_ID}} | {{TR_REFS}} |
