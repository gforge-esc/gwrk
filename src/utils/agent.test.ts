/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchToAgent, SAFE_AGENT_ENV, COMMAND_SAFETY_BLOCK } from './agent.js';
import * as skillRuntime from '../plugins/skill-runtime.js';
import * as extensionRuntime from '../plugins/extension-runtime.js';
import { execFileSync, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { loadConfig } from './config.js';

vi.mock('../plugins/skill-runtime.js');
vi.mock('../plugins/extension-runtime.js', () => ({
  resolveExtensionContext: vi.fn().mockResolvedValue([]),
}));
vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: vi.fn(),
}));
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
      define: 'agy',
      implement: 'agy'
    }
  })
}));

function mockAgentStdin(onSpawn?: () => void) {
  let capturedStdin = '';
  vi.mocked(spawn).mockImplementation(() => {
    onSpawn?.();
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    child.stdin.on('data', (chunk) => { capturedStdin += chunk.toString(); });
    setImmediate(() => {
      child.stdout.end();
      child.stderr.end();
      child.emit('close', 0);
    });
    return child as ReturnType<typeof spawn>;
  });
  return () => capturedStdin;
}

describe('US-016: Enforcement Skills Dispatch Injection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends identical legacy prompt and stdin once", async () => {
    const prompt = "Plan the requested phase.";
    const result = await dispatchToAgent({
      workflow: "gwrk-plan",
      workDir: "/fake/root",
      agent: "agy",
      prompt,
      stdin: prompt,
      dryRun: true,
      quiet: true,
    });

    expect(result.stdout.match(/Plan the requested phase\./g)).toHaveLength(1);
    expect(result.stdout.match(/<command_safety>/g)).toHaveLength(1);
  });

  it('TR-P9-005: injects enforcement skills into <code_quality> section', async () => {
    vi.mocked(skillRuntime.resolveEnforcementSkills).mockResolvedValue('# Strict Typing Rule');
    
    const capturedStdin = mockAgentStdin();
    const promptParts = { template: '<code_quality></code_quality>', userInput: '' };

    await dispatchToAgent({
      workflow: 'gwrk-implement',
      workDir: '/fake/root',
      agent: 'agy',
      stdin: promptParts.template,
      promptParts,
    });

    expect(skillRuntime.resolveEnforcementSkills).toHaveBeenCalledWith(
      '/fake/root',
      'implementation',
      expect.objectContaining({ stack: { language: 'TypeScript' } }),
    );
    expect(capturedStdin()).toContain('<code_quality>\n# Strict Typing Rule\n</code_quality>');
  });

  it("expands bare enforcement in legacy stdin while preserving scoped input", async () => {
    vi.mocked(skillRuntime.resolveEnforcementSkills).mockResolvedValue("# Strict Typing Rule");
    const scopedInput = "<user_input>\nKeep {{enforcement}} as written.\n</user_input>";
    const result = await dispatchToAgent({
      workflow: "gwrk-implement",
      workDir: "/fake/root",
      agent: "agy",
      prompt: "Do the work.",
      stdin: `Rules:\n{{enforcement}}\n\n${scopedInput}`,
      dryRun: true,
    });

    expect(result.stdout).toContain("Rules:\n# Strict Typing Rule");
    expect(result.stdout).toContain(scopedInput);
  });

  it('expands template enforcement even when the template quotes the input tag', async () => {
    vi.mocked(skillRuntime.resolveEnforcementSkills).mockResolvedValue('# Strict Typing Rule');
    const capturedStdin = mockAgentStdin();
    const input = '<user_input>\n  Keep {{enforcement}} in <code_quality>{{enforcement}}</code_quality>.\r\n</user_input>';
    const template = 'Quote `<user_input>` and keep {{enforcement}} here.\n<code_quality>\n{{enforcement}}\n</code_quality>';
    const promptParts = { template, userInput: input };

    await dispatchToAgent({
      workflow: 'gwrk-implement',
      workDir: '/fake/root',
      agent: 'agy',
      stdin: `${template}\n\n${input}`,
      promptParts,
    });

    expect(capturedStdin()).toContain('<code_quality>\n# Strict Typing Rule\n</code_quality>');
    expect(capturedStdin().endsWith(`\n\n${input}`)).toBe(true);
    expect(capturedStdin()).toContain('Quote `<user_input>` and keep {{enforcement}} here.');
  });

  it('preserves a code quality fixture in a prompt-only task', async () => {
    vi.mocked(skillRuntime.resolveEnforcementSkills).mockResolvedValue('# Strict Typing Rule');
    const capturedStdin = mockAgentStdin();
    const prompt = '  Keep this fixture:\r\n<code_quality>{{enforcement}}</code_quality>\r\n';

    await dispatchToAgent({
      workflow: 'gwrk-implement',
      workDir: '/fake/root',
      agent: 'agy',
      prompt,
    });

    expect(capturedStdin()).toBe(`${COMMAND_SAFETY_BLOCK}\n\n${prompt}`);
    expect(skillRuntime.resolveEnforcementSkills).not.toHaveBeenCalled();
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

    it.each([
      ['the opening tag', '<command_safety>'],
      ['the full block', COMMAND_SAFETY_BLOCK],
    ])('injects the full policy before scoped input that quotes %s', async (_label, quote) => {
      const capturedStdin = mockAgentStdin();
      const userInput = `<user_input>\nQuote this:\n${quote}\n</user_input>`;
      const template = 'Do the work.';
      const promptParts = { template, userInput };

      await dispatchToAgent({
        workflow: 'gwrk-implement',
        workDir: '/fake/root',
        agent: 'agy',
        stdin: `${template}\n\n${userInput}`,
        promptParts,
      });

      expect(capturedStdin()).toBe(`${COMMAND_SAFETY_BLOCK}\n\n${template}\n\n${userInput}`);
    });

    it('sends a single copy when the full policy is already present', async () => {
      const capturedStdin = mockAgentStdin();
      const template = `Do the work.\n${COMMAND_SAFETY_BLOCK}`;
      const userInput = '<user_input>\nTask instructions\n</user_input>';
      const promptParts = { template, userInput };

      await dispatchToAgent({
        workflow: 'gwrk-implement',
        workDir: '/fake/root',
        agent: 'agy',
        stdin: `${template}\n\n${userInput}`,
        promptParts,
      });

      expect(capturedStdin()).toBe(`${template}\n\n${userInput}`);
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
        agent: 'agy',
        stdin: 'Test prompt'
      });

      for (const [key, value] of Object.entries(SAFE_AGENT_ENV)) {
        expect(capturedEnv[key]).toBe(value);
      }
    });
  });
});

it('uses the primary checkout throttle for a dispatch in a linked worktree', async () => {
  const actualConfig = await vi.importActual<typeof import('./config.js')>('./config.js');
  const fixture = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gwrk-throttle-')));
  const primary = path.join(fixture, 'primary checkout');
  const workDir = path.join(fixture, 'linked worktree');
  const runsDir = path.join(primary, '.runs');
  const statePath = path.join(runsDir, 'last-dispatch.state');
  const throttleMs = 300;
  const git = (...args: string[]) => execFileSync('git', args, {
    cwd: primary,
    stdio: 'pipe',
    env: { ...process.env, ...SAFE_AGENT_ENV },
  });

  try {
    fs.mkdirSync(primary);
    git('init');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com',
      '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null',
      'commit', '--author=Test <test@example.com>', '--no-edit', '--allow-empty', '-m', 'Fixture');
    git('worktree', 'add', '--detach', workDir, 'HEAD');
    for (const checkout of [primary, workDir]) {
      fs.writeFileSync(path.join(checkout, '.gwrkrc.json'), JSON.stringify({ project: { name: 'fixture' } }));
    }
    fs.writeFileSync(path.join(primary, '.gwrkrc.local.json'), JSON.stringify({ agents: { throttleMs } }));
    fs.mkdirSync(runsDir);
    vi.stubEnv('GWRK_HOME', path.join(fixture, 'home'));
    expect(actualConfig.loadConfig(primary).agents.throttleMs).toBe(throttleMs);
    expect(actualConfig.loadConfig(workDir).agents.throttleMs).toBeUndefined();
    vi.mocked(loadConfig).mockImplementationOnce(actualConfig.loadConfig);

    let timestampAtSpawn = 0;
    const capturedStdin = mockAgentStdin(() => {
      timestampAtSpawn = Number(fs.readFileSync(statePath, 'utf8'));
    });
    fs.mkdirSync(path.join(workDir, '.gwrk'));
    fs.writeFileSync(path.join(workDir, '.gwrk', 'architecture.md'), 'Worktree grounding');
    const lastDispatch = Date.now();
    fs.writeFileSync(statePath, String(lastDispatch));

    await dispatchToAgent({
      workflow: 'gwrk-implement',
      workDir,
      agent: 'agy',
      stdin: 'Implement the task',
    });

    expect(timestampAtSpawn - lastDispatch).toBeGreaterThanOrEqual(throttleMs);
    expect(fs.readFileSync(statePath, 'utf8')).toBe(String(timestampAtSpawn));
    expect(spawn).toHaveBeenLastCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({ cwd: workDir }));
    expect(capturedStdin()).toContain('Worktree grounding');
    expect(fs.existsSync(path.join(workDir, '.runs', 'last-dispatch.state'))).toBe(false);
  } finally {
    vi.unstubAllEnvs();
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

describe("TR-018: Context Injection in Dispatch (Phase 21)", () => {
  it("selects extension context from the scoped task rather than the assembled template", async () => {
    const template = fs.readFileSync(
      new URL("../plugins/builtins/workflows/gwrk-implement/PROMPT.md", import.meta.url),
      "utf8",
    );
    const userInput = "<user_input>\nVerify the idempotency guarantee.\n</user_input>";
    vi.mocked(extensionRuntime.resolveExtensionContext).mockImplementationOnce(
      async (_workDir, keywords) =>
        keywords?.includes("idempotency")
          ? [{ source: "project_rules", content: "Use the durable operation key." }]
          : [],
    );

    const result = await dispatchToAgent({
      agent: "agy",
      workflow: "gwrk-implement",
      featureDir: "specs/043-unified-routing-prompt-delivery",
      promptParts: { template, userInput },
      stdin: `${template}\n\n${userInput}`,
      dryRun: true,
    });

    expect(result.stdout).toContain("<project_rules>\nUse the durable operation key.");
    expect(result.stdout).toContain(userInput);
  });

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
      agent: 'agy',
      stdin: 'Test extension context'
    });

    expect(capturedStdin).toContain('<external_context>');
  });
});

describe("quiet-mode progress against a redirected stdout", () => {
  /** Hold the child open long enough that a 200ms spinner would have ticked. */
  function mockLongRunningChild(ms: number) {
    vi.mocked(spawn).mockImplementation(() => {
      const mockChild = new EventEmitter() as any;
      mockChild.stdin = new PassThrough();
      mockChild.stdout = new PassThrough();
      mockChild.stderr = new PassThrough();
      setTimeout(() => {
        mockChild.stdout.end();
        mockChild.stderr.end();
        mockChild.emit('close', 0);
      }, ms);
      return mockChild;
    });
  }

  async function captureStdout(isTTY: boolean, run: () => Promise<unknown>) {
    const original = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', {
      value: isTTY,
      configurable: true,
    });
    const written: string[] = [];
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: any) => {
        written.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
      });

    try {
      await run();
    } finally {
      spy.mockRestore();
      Object.defineProperty(process.stdout, 'isTTY', {
        value: original,
        configurable: true,
      });
    }
    return written.join('');
  }

  // A 68-minute stage once left 20,284 carriage-returned frames in a
  // redirected ship log — `\r` overwrites a terminal, not a file.
  it('writes no carriage returns when stdout is not a TTY', async () => {
    mockLongRunningChild(700);

    const out = await captureStdout(false, () =>
      dispatchToAgent({
        workflow: 'gwrk-implement',
        workDir: '/fake/root',
        agent: 'agy',
        stdin: 'anything',
        quiet: true,
      }),
    );

    expect(out).not.toContain('\r');
    expect(out).toContain('agent done');
  });

  it('still animates in place when stdout is a TTY', async () => {
    mockLongRunningChild(700);

    const out = await captureStdout(true, () =>
      dispatchToAgent({
        workflow: 'gwrk-implement',
        workDir: '/fake/root',
        agent: 'agy',
        stdin: 'anything',
        quiet: true,
      }),
    );

    expect(out).toContain('\r');
    expect(out).toContain('agent running');
  });

  it('forwards model and env (--model, --effort) to spawned claude args and closes stdin when empty', async () => {
    let capturedArgs: string[] = [];
    let stdinEnded = false;

    vi.mocked(spawn).mockImplementation((_cmd: any, args: any) => {
      capturedArgs = args ?? [];
      const mockChild = new EventEmitter() as any;
      const stdin = new PassThrough();
      stdin.on('finish', () => {
        stdinEnded = true;
      });
      mockChild.stdin = stdin;
      mockChild.stdout = new PassThrough();
      mockChild.stderr = new PassThrough();
      setTimeout(() => {
        mockChild.stdout.end();
        mockChild.stderr.end();
        mockChild.emit('close', 0);
      }, 20);
      return mockChild;
    });

    await dispatchToAgent({
      workflow: 'gwrk-implement',
      workDir: '/fake/root',
      agent: 'claude',
      model: 'claude-opus-4-6',
      env: { CLAUDE_EFFORT: 'high' },
      prompt: 'implement feature',
    });

    expect(capturedArgs).toContain('--model');
    expect(capturedArgs).toContain('claude-opus-4-6');
    expect(capturedArgs).toContain('--effort');
    expect(capturedArgs).toContain('high');
    expect(stdinEnded).toBe(true);
  });
});
