import { describe, it, expect, vi } from 'vitest';
import { tasksGenerateCommand } from './tasks-generate.js';
import { Command } from 'commander';
import { WorkflowRuntime } from '../plugins/workflow-runtime.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

vi.mock('../plugins/workflow-runtime.js', () => ({
  WorkflowRuntime: class {
    executeWorkflow = vi.fn().mockResolvedValue({ summary: 'ok', intents: [] });
  }
}));

vi.mock('../utils/manifest.js', () => ({
  writeManifest: vi.fn(),
  generateRunId: vi.fn().mockReturnValue('mock-run-id')
}));

describe('tasks-generate (Phase 12) (RED)', () => {
  it('FR-028: MUST pass quiet: true to executeWorkflow for gate generation (RED)', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-gen-phase12-'));
    const specDir = path.join(tempDir, 'specs', 'test-feature');
    fs.mkdirSync(path.join(specDir, '.gwrk'), { recursive: true });
    fs.writeFileSync(path.join(specDir, 'plan.md'), '# Plan\n### Phase 1\n- file.ts\n#### Done When\n- test -f file.ts');
    fs.writeFileSync(path.join(tempDir, '.gwrkrc.json'), JSON.stringify({ project: { name: 'test' }, agents: { define: 'mock' } }));
    
    vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    
    const program = new Command();
    program.addCommand(tasksGenerateCommand);
    
    await program.parseAsync(['node', 'test', 'tasks', 'test-feature', '--force']);
    
    const runtimeInstance = new WorkflowRuntime();
    expect(runtimeInstance.executeWorkflow).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        quiet: true
      })
    );
    
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
