/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchToAgent, SAFE_AGENT_ENV, COMMAND_SAFETY_BLOCK } from './agent.js';
import * as skillRuntime from '../plugins/skill-runtime.js';
import * as extensionRuntime from '../plugins/extension-runtime.js';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

vi.mock('../plugins/skill-runtime.js');
vi.mock('../plugins/extension-runtime.js', () => ({
  resolveExtensionContext: vi.fn().mockResolvedValue([]),
}));
vi.mock('node:child_process');
vi.mock('../engine/profile-detector.js', () => ({
  detectProfile: vi.fn().mockResolvedValue({
    type: 'nodejs',
    stack: { language: 'TypeScript' },
    layout: 'flat',
  }),
}));
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

    expect(skillRuntime.resolveEnforcementSkills).toHaveBeenCalledWith(
      '/fake/root',
      'implementation',
      expect.objectContaining({ stack: { language: 'TypeScript' } }),
    );
    expect(capturedStdin).toContain('# Strict Typing Rule');
  });
});

describe('ADR-008: Command Safety Posture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Layer 1: COMMAND_SAFETY_BLOCK', () => {
    it('contains all 8 safety rules', () => {
      expect(COMMAND_SAFETY_BLOCK).toContain('<command_safety>');
      expect(COMMAND_SAFETY_BLOCK).toContain('</command_safety>');
      expect(COMMAND_SAFETY_BLOCK).toContain('NEVER run interactive commands');
      expect(COMMAND_SAFETY_BLOCK).toContain('NEVER start long-running servers');
      expect(COMMAND_SAFETY_BLOCK).toContain('--no-edit');
      expect(COMMAND_SAFETY_BLOCK).toContain('GIT_EDITOR=true');
      expect(COMMAND_SAFETY_BLOCK).toContain('CONFLICT');
      expect(COMMAND_SAFETY_BLOCK).toContain('git merge --abort');
      expect(COMMAND_SAFETY_BLOCK).toContain('timeout 120');
      expect(COMMAND_SAFETY_BLOCK).toContain('NEVER run: vim');
    });

    it('injects <command_safety> block into dispatch stdin', async () => {
      vi.mocked(skillRuntime.resolveEnforcementSkills).mockResolvedValue('');

      let capturedStdin = '';
      vi.mocked(spawn).mockImplementation(() => {
        const mockChild = new EventEmitter() as any;
        const stdin = new PassThrough();
        stdin.on('data', (chunk) => { capturedStdin += chunk.toString(); });
        mockChild.stdin = stdin;
        mockChild.stdout = new PassThrough();
        mockChild.stderr = new PassThrough();
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
        stdin: 'Implement this feature'
      });

      expect(capturedStdin).toContain('<command_safety>');
      expect(capturedStdin).toContain('</command_safety>');
      expect(capturedStdin.indexOf('<command_safety>')).toBeLessThan(
        capturedStdin.indexOf('Implement this feature')
      );
    });

    it('does not double-inject if <command_safety> already present', async () => {
      vi.mocked(skillRuntime.resolveEnforcementSkills).mockResolvedValue('');

      let capturedStdin = '';
      vi.mocked(spawn).mockImplementation(() => {
        const mockChild = new EventEmitter() as any;
        const stdin = new PassThrough();
        stdin.on('data', (chunk) => { capturedStdin += chunk.toString(); });
        mockChild.stdin = stdin;
        mockChild.stdout = new PassThrough();
        mockChild.stderr = new PassThrough();
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
        stdin: '<command_safety>Custom rules</command_safety>\nDo the work'
      });

      const matches = capturedStdin.match(/<command_safety>/g);
      expect(matches).toHaveLength(1);
    });
  });

  describe('Layer 2: SAFE_AGENT_ENV', () => {
    it('contains all required safety environment variables', () => {
      expect(SAFE_AGENT_ENV.GIT_EDITOR).toBe('true');
      expect(SAFE_AGENT_ENV.EDITOR).toBe('true');
      expect(SAFE_AGENT_ENV.VISUAL).toBe('true');
      expect(SAFE_AGENT_ENV.GIT_MERGE_AUTOEDIT).toBe('no');
      expect(SAFE_AGENT_ENV.DEBIAN_FRONTEND).toBe('noninteractive');
      expect(SAFE_AGENT_ENV.CI).toBe('true');
      expect(SAFE_AGENT_ENV.npm_config_yes).toBe('true');
    });

    it('passes SAFE_AGENT_ENV to spawned process', async () => {
      vi.mocked(skillRuntime.resolveEnforcementSkills).mockResolvedValue('');

      let capturedEnv: Record<string, string> = {};
      vi.mocked(spawn).mockImplementation((_cmd: any, _args: any, options: any) => {
        capturedEnv = options?.env ?? {};
        const mockChild = new EventEmitter() as any;
        mockChild.stdin = new PassThrough();
        mockChild.stdout = new PassThrough();
        mockChild.stderr = new PassThrough();
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
        stdin: 'Test prompt'
      });

      for (const [key, value] of Object.entries(SAFE_AGENT_ENV)) {
        expect(capturedEnv[key]).toBe(value);
      }
    });
  });
});

describe("TR-018: Context Injection in Dispatch (Phase 21)", () => {
  it("FR-L3-006: injects output of resolveExtensionContext into prompt", async () => {
    vi.mocked(extensionRuntime.resolveExtensionContext).mockResolvedValue([
      { source: "test-source", content: "External Context Content", relevance: 1.0 }
    ]);

    let capturedStdin = '';
    vi.mocked(spawn).mockImplementation(() => {
      const mockChild = new EventEmitter() as any;
      const stdin = new PassThrough();
      stdin.on('data', (chunk) => { capturedStdin += chunk.toString(); });
      mockChild.stdin = stdin;
      mockChild.stdout = new PassThrough();
      mockChild.stderr = new PassThrough();
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
      stdin: 'Test extension context'
    });

    expect(capturedStdin).toContain('<external_context>');
  });
});