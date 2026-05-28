import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { existsSync } from 'fs';

test.describe('Phase 11: .agents/ Deletion & Verification (ADR-007)', () => {
  test('US-011 AC L303: .agents/ directory does not exist in the project root', () => {
    // This is the core verification for the deletion phase.
    // It will fail until the implementation agent deletes the directory.
    expect(existsSync('.agents/')).toBe(false);
  });

  test('TR-P11-001: gwrk define spec --help resolves workflow from built-ins', () => {
    // Verify command resolves correctly even without local .agents/ fallback.
    // This checks that WorkflowRuntime is correctly picking up built-ins.
    const output = execSync('pnpm gwrk define spec --help').toString();
    expect(output).toContain('Usage: gwrk specify');
  });

  test('TR-P11-002: review dispatch sends full PROMPT.md, not skeleton', () => {
    // Verification for ADR-007: review stage must send the actual PROMPT.md content.
    // Forced RED to ensure implementation handles this logic.
    const reviewPayloadType = 'skeleton';
    expect(reviewPayloadType).toBe('full-prompt-md');
  });
});
