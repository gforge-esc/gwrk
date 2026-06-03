import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

test.describe('Phase 16: Toolchain Detection (Acceptance)', () => {
  let testDir: string;

  test.beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwrk-test-'));
  });

  test.afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('US-023 Scenario 1: detects biome in a TS project', async () => {
    fs.writeFileSync(path.join(testDir, 'biome.json'), '{}');
    fs.writeFileSync(path.join(testDir, 'package.json'), '{"name":"test"}');

    try {
      const output = execSync(`pnpm gwrk project info --format json`, { cwd: testDir }).toString();
      const json = JSON.parse(output);
      expect(json.toolchain.primary).toBe('biome');
    } catch (e) {
      // This is expected to fail pre-implementation
      throw new Error('RED: Command failed or output missing toolchain: ' + e.message);
    }
  });
});