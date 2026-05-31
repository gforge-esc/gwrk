import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchToAgent } from './agent.js';
import * as skillRuntime from '../plugins/skill-runtime.js';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

vi.mock('../plugins/skill-runtime.js');
vi.mock('node:child_process');
vi.mock('./config.js', () => ({
  loadConfig: vi.fn().mockReturnValue({
    agents: {
      throttleMs: 0,
      define: 'gemini',
      implement: 'gemini'
    }
  })
}));

describe('US-016: Enforcement Skills Dispatch Injection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('TR-P9-005: injects enforcement skills into <code_quality> section', async () => {
    vi.mocked(skillRuntime.resolveEnforcementSkills).mockResolvedValue('# Strict Typing Rule');
    
    let capturedStdin = '';
    vi.mocked(spawn).mockImplementation(() => {
      const mockChild = new EventEmitter() as any;
      const stdin = new PassThrough();
      stdin.on('data', (chunk) => { capturedStdin += chunk.toString(); });
      mockChild.stdin = stdin;
      mockChild.stdout = new PassThrough();
      mockChild.stderr = new PassThrough();

      // End process after a short delay to allow listeners to attach
      setTimeout(() => {
        mockChild.stdout.end();
        mockChild.stderr.end();
        mockChild.emit('close', 0);
      }, 50);

      return mockChild;
    });

    await dispatchToAgent({
      workflow: 'gwrk-implement',
      workDir: '/fake/root',
      agent: 'gemini',
      stdin: '<code_quality></code_quality>'
    });

    expect(skillRuntime.resolveEnforcementSkills).toHaveBeenCalledWith('/fake/root', 'implementation');
    expect(capturedStdin).toContain('# Strict Typing Rule');
  });
});
