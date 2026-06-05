import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

test.describe('Phase 15: Profile-Aware Enforcement Routing (US-016)', () => {
  const projectDir = 'tmp/python-project';

  test.beforeAll(() => {
    if (existsSync(projectDir)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(path.join(projectDir, '.gwrk'), { recursive: true });
    
    // Create a mock .gwrkrc.json that suggests Python
    writeFileSync(path.join(projectDir, '.gwrkrc.json'), JSON.stringify({
      profile: {
        type: 'python',
        stack: { language: 'Python' }
      }
    }));

    // Create a requirements.txt to help detection
    writeFileSync(path.join(projectDir, 'requirements.txt'), '');
  });

  test.afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  test('US-016: Python project should not list typescript-standards', () => {
    // We assume 'typescript-standards' is a builtin enforcement skill with language: TypeScript
    // Run command in the project directory
    try {
      const output = execSync('pnpm gwrk plugin list --project --type skill --tier enforcement', {
        cwd: projectDir
      }).toString();
      
      // Should fail (RED) because implementation might not be filtering the 'list' output yet
      expect(output).not.toContain('typescript-standards');
    } catch (e) {
      // If the command fails, it's also RED (e.g. if --project is not supported correctly)
      throw e;
    }
  });

  test('FR-014: resolveEnforcementSkills filters by framework', () => {
    // This is hard to test via CLI without a command that specifically calls resolveEnforcementSkills
    // and outputs the result. But 'plugin list' is our best proxy.
    // If we have a 'react-standards' builtin, it should be filtered out in a Python project.
    const output = execSync('pnpm gwrk plugin list --project', {
      cwd: projectDir
    }).toString();
    
    expect(output).not.toContain('react-standards');
  });
});
