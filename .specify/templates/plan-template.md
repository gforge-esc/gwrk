# Implementation Plan: {{FEATURE_NUMBER}} {{FEATURE_NAME}}

**Branch**: `{{BRANCH_NAME}}` | **Date**: {{DATE}} | **Spec**: [spec.md](./spec.md)

## Summary

{{SUMMARY}}

---

## Phases and File Structure

### Phase {{N}}: {{PHASE_NAME}}

{{PHASE_DESCRIPTION}}

**Files ({{FILE_COUNT}}):**
- `{{FILE_PATH}}` ({{NEW_OR_MODIFY}}: {{FILE_DESCRIPTION}})

<!-- Repeat file entries -->

**Requirements Addressed:** {{FR_REFS}}, {{US_REFS}}, {{TC_REFS}}

**Dependencies:** {{PHASE_DEPS}}

**Contract Mapping:**
<!-- If contracts/ exist, map each contract method to this phase -->
- `contracts/{{CONTRACT_FILE}}` → `{{METHOD}}` → `{{IMPLEMENTATION_FILE}}`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| {{RULE_NAME}} | {{APPLICABILITY}} |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| {{TR_ID}} | {{TEST_TYPE}} | `{{TARGET}}` | {{ASSERTION}} |

#### Done When
- `{{EXECUTABLE_ASSERTION}}` exits 0

<!-- Repeat phase block for each phase -->

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| {{TYPE_NAME}} | `{{DEFINED_IN}}` | {{CONSUMED_BY}} |

---

## Mockup-to-Selector Mapping

<!-- If no mockups: -->
_No mockups exist for this feature._

<!-- If mockups exist, map region → selector → component -->

---

## Deferred Items

<!-- If all items are planned: -->
<!-- None — full coverage. -->

| Spec Item | Title | Reason | Target |
|---|---|---|---|
| {{SPEC_ITEM}} | {{TITLE}} | {{REASON}} | {{TARGET}} |

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| {{SPEC_ITEM}} | {{PHASE_NUMBER}} | {{STATUS}} |
