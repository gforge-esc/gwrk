import fs from 'node:fs';
import path from 'node:path';
import os from 'os';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
// @ts-ignore - Module does not exist yet (RED)
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
});