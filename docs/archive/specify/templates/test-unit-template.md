# Unit Test Template (Vitest)

Use this template when generating red test files from `/define-tests`.

```typescript
// {{TEST_FILE_PATH}}
import { describe, it, expect } from 'vitest';
import { {{IMPORT_NAME}} } from '{{MODULE_PATH}}'; // RED — module may not exist yet

describe('{{FR_ID}}: {{FR_TITLE}}', () => {
  it('{{ACCEPTANCE_SCENARIO_DESCRIPTION}}', () => {
    // {{US_ID}} acceptance scenario {{N}}
    {{TEST_BODY}}
  });

  it('rejects invalid input: {{ERROR_CONDITION}}', () => {
    // Negative path — {{FR_ID}} error state
    expect(() => {{CALL}}).toThrow({{EXPECTED_ERROR}});
  });
});
```

## Rules
- `describe` block ID MUST match `FR-###` from spec
- `it` block MUST map to a specific `US-###` acceptance scenario
- Include ≥1 negative path per `describe` block
- Assert against contract-defined return shapes (Zod `.parse()` for TS)
- Import from real module path in plan.md — this is what makes it RED
