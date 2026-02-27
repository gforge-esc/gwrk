# Gap Analysis: {{FEATURE_NAME}}

## Audit Scope
- Files read: {{FILES_READ_COUNT}}
- Contracts compared: {{CONTRACTS_COMPARED_COUNT}}
- Governance rules checked: {{RULES_CHECKED_COUNT}}

## Findings

### `{{FILE_PATH}}`
| Check/Rule | Expected | Actual | Class |
|---|---|---|---|
| {{CHECK_NAME}} | {{EXPECTED}} | {{ACTUAL}} | {{CLASS}} |

<!-- Repeat per file. For greenfield files: -->
### `{{FILE_PATH}}` (greenfield — does not exist)

## Summary
- Total gaps: {{TOTAL_GAPS}} (greenfield: {{N}}, wrong: {{N}}, missing: {{N}}, dead: {{N}}, untested: {{N}})
- Compile-chain risks: {{COMPILE_RISKS}}

<!-- CLASS values: greenfield, wrong, missing, dead, untested -->
