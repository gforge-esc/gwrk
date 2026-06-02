import fs from 'node:fs';
import path from 'node:path';
import os from 'os';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { scanReadiness } from './readiness-scanner.js';

describe('src/engine/readiness-scanner.ts (FR-018)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwrk-scanner-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should assign L0 if only directory exists', () => {
    fs.mkdirSync(path.join(tempDir, 'feat-l0'), { recursive: true });
    const results = scanReadiness(tempDir);
    const res = results.find(r => r.featureId === 'feat-l0');
    expect(res).toMatchObject({ level: 0, status: 'PLANNED', hasSpec: false, hasPlan: false, hasTasks: false });
  });

  it('should assign L1 if spec.md exists', () => {
    const dir = path.join(tempDir, 'feat-l1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'spec.md'), '# Spec');
    const results = scanReadiness(tempDir);
    const res = results.find(r => r.featureId === 'feat-l1');
    expect(res).toMatchObject({ level: 1, status: 'SPECIFIED', hasSpec: true, hasPlan: false, hasTasks: false });
  });

  it('should assign L2 if spec.md and plan.md exist', () => {
    const dir = path.join(tempDir, 'feat-l2');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'spec.md'), '# Spec');
    fs.writeFileSync(path.join(dir, 'plan.md'), '# Plan');
    const results = scanReadiness(tempDir);
    const res = results.find(r => r.featureId === 'feat-l2');
    expect(res).toMatchObject({ level: 2, status: 'DEFINED', hasSpec: true, hasPlan: true, hasTasks: false });
  });

  it('should assign L3 if spec.md, plan.md and tasks.json exist', () => {
    const dir = path.join(tempDir, 'feat-l3');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'spec.md'), '# Spec');
    fs.writeFileSync(path.join(dir, 'plan.md'), '# Plan');
    fs.mkdirSync(path.join(dir, '.gwrk'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.gwrk/tasks.json'), JSON.stringify({ 
      tasks: [{ id: 'T1', sp: 5 }, { id: 'T2', sp: 8 }] 
    }));
    const results = scanReadiness(tempDir);
    const res = results.find(r => r.featureId === 'feat-l3');
    expect(res).toMatchObject({ level: 3, status: 'DEFINED', hasSpec: true, hasPlan: true, hasTasks: true, spTotal: 13 });
  });

  it('should parse phases from plan.md with ### Phase N: headings', () => {
    const dir = path.join(tempDir, 'feat-phases');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'spec.md'), '# Spec');
    fs.writeFileSync(path.join(dir, 'plan.md'), [
      '# Plan',
      '',
      '### Phase 1: Foundation',
      '',
      '**Files (1):**',
      '- `src/setup.ts` (NEW: Create setup)',
      '',
      '### Phase 2: Integration',
      '',
      '**Files (1):**',
      '- `src/api.ts` (NEW: Create API)',
      '',
      '### Phase 3: Polish',
      '',
      '**Files (1):**',
      '- `src/ui.ts` (MODIFY: Update UI)',
    ].join('\n'));

    const results = scanReadiness(tempDir);
    const res = results.find(r => r.featureId === 'feat-phases');
    expect(res?.phases).toHaveLength(3);
    expect(res?.phases[0]).toEqual({ number: 1, title: 'Foundation' });
    expect(res?.phases[1]).toEqual({ number: 2, title: 'Integration' });
    expect(res?.phases[2]).toEqual({ number: 3, title: 'Polish' });
  });

  it('should return empty phases when plan.md has no Phase headings', () => {
    const dir = path.join(tempDir, 'feat-no-phases');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'spec.md'), '# Spec');
    fs.writeFileSync(path.join(dir, 'plan.md'), '# Plan\n\nJust some notes without phases.');

    const results = scanReadiness(tempDir);
    const res = results.find(r => r.featureId === 'feat-no-phases');
    expect(res?.phases).toEqual([]);
  });

  it('should return empty phases when no plan.md exists', () => {
    fs.mkdirSync(path.join(tempDir, 'feat-no-plan'), { recursive: true });
    const results = scanReadiness(tempDir);
    const res = results.find(r => r.featureId === 'feat-no-plan');
    expect(res?.phases).toEqual([]);
  });
});