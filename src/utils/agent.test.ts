/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchToAgent, SAFE_AGENT_ENV, COMMAND_SAFETY_BLOCK } from './agent.js';
import * as skillRuntime from '../plugins/skill-runtime.js';
import * as extensionRuntime from '../plugins/extension-runtime.js';
import { WorkflowRuntime } from '../plugins/workflow-runtime.js';
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

  it("preserves bare enforcement markers in the template outside the code quality section", async () => {
    const template = "Rules:\n{{enforcement}}";
    const userInput = "<user_input>\nKeep {{enforcement}} as written.\n</user_input>";
    const capturedStdin = mockAgentStdin();

    await dispatchToAgent({
      workflow: "gwrk-implement",
      workDir: "/fake/root",
      agent: "agy",
      stdin: `${template}\n\n${userInput}`,
      promptParts: { template, userInput },
    });

    expect(capturedStdin()).toBe(`${COMMAND_SAFETY_BLOCK}\n\n${template}\n\n${userInput}`);
    expect(skillRuntime.resolveEnforcementSkills).not.toHaveBeenCalled();
  });

  const legacyInput = "<user_input>\r\n  Keep {{enforcement}} and <code_quality></code_quality>.  \r\n</user_input>\r\n";
  const legacyPrefix = "Rules:\r\n{{enforcement}}\r\n\r\n";
  const enforcementSection = "<code_quality>\r\n{{enforcement}}\r\n</code_quality>";
  const nestedInput = "<user_input>\r\n  Nested example.  \r\n</user_input>";

  it.each(["structured", "legacy"] as const)(
    "preserves a quoted empty section before the enforcement slot in %s Codex stdin",
    async (transport) => {
      const actualSkills = await vi.importActual<typeof skillRuntime>("../plugins/skill-runtime.js");
      vi.mocked(skillRuntime.resolveEnforcementSkills).mockImplementationOnce(actualSkills.resolveEnforcementSkills);
      const capturedStdin = mockAgentStdin();
      const example = "Quote `<code_quality></code_quality>` as written.\r\n";
      const template = example + enforcementSection;
      const userInput = `<user_input>\r\n${enforcementSection}\r\n${nestedInput}\r\n  Keep {{enforcement}}.  \r\n</user_input>\r\n`;
      const separator = transport === "structured" ? "\n\n" : "\r\n\r\n";

      await dispatchToAgent({
        workflow: "gwrk-implement",
        workDir: "/fake/root",
        agent: "codex",
        stdin: template + separator + userInput,
        promptParts: transport === "structured" ? { template, userInput } : undefined,
        quiet: true,
      });

      const payload = capturedStdin();
      const prefix = `${COMMAND_SAFETY_BLOCK}\n\n${example}<code_quality>\r\n`;
      const suffix = `\r\n</code_quality>${separator}${userInput}`;
      expect(payload.slice(0, prefix.length)).toBe(prefix);
      expect(payload.slice(-suffix.length)).toBe(suffix);
      const rules = payload.slice(prefix.length, -suffix.length);
      expect(rules).toContain("<!-- enforcement-skill: typescript-standards -->");
      expect(rules).not.toContain("{{enforcement}}");
    },
  );

  it.each([
    ["a standalone empty section", "<code_quality></code_quality>"],
    ["a standalone enforcement section", "<code_quality>\r\n{{enforcement}}\r\n</code_quality>"],
    ["a standalone enforcement section with surrounding rules", "<code_quality>\r\nRules:\r\n{{enforcement}}\r\n</code_quality>"],
    ["a bare marker after a quoted input opener", `Quoted opener:\r\n<user_input>\r\n\r\n${legacyPrefix}${legacyInput}`],
    ["an empty section before scoped input", `Rules:\r\n<code_quality></code_quality>\r\n\r\n${legacyInput}`],
    ["a multiline empty section before scoped input", `Rules:\r\n<code_quality>\r\n</code_quality>\r\n\r\n${legacyInput}`],
    ["a code quality slot before scoped input", `Rules:\r\n<code_quality>\r\n{{enforcement}}\r\n</code_quality>\r\n\r\n${legacyInput}`],
    ["a code quality slot after a quoted input opener", `Quoted opener:\r\n<user_input>\r\n\r\nRules:\r\n<code_quality>\r\n{{enforcement}}\r\n</code_quality>\r\n\r\n${legacyInput}`],
    ["a bare marker after a code quality fixture", `Keep <code_quality>example rules</code_quality>.\r\n${legacyPrefix}${legacyInput}`],
    ["a bare marker before scoped input", `${legacyPrefix}${legacyInput}`],
  ])("expands %s in legacy Codex stdin", async (_label, stdin) => {
    const actualSkills = await vi.importActual<typeof skillRuntime>("../plugins/skill-runtime.js");
    vi.mocked(skillRuntime.resolveEnforcementSkills).mockImplementationOnce(actualSkills.resolveEnforcementSkills);
    const capturedStdin = mockAgentStdin();

    await dispatchToAgent({
      workflow: "gwrk-implement",
      workDir: "/fake/root",
      agent: "codex",
      stdin,
      quiet: true,
    });

    const [template, userInput] = stdin.includes(legacyInput)
      ? [stdin.slice(0, -legacyInput.length), legacyInput]
      : [stdin, ""];
    const payload = capturedStdin();
    const expandedTemplate = payload.slice(0, payload.length - userInput.length);
    expect(expandedTemplate).toContain("<!-- enforcement-skill: typescript-standards -->");
    expect(expandedTemplate).not.toContain("{{enforcement}}");
    expect(payload.slice(expandedTemplate.length)).toBe(userInput);
    expect(expandedTemplate.startsWith(`${COMMAND_SAFETY_BLOCK}\n\n`)).toBe(true);
    if (!userInput) {
      expect(expandedTemplate).toMatch(/<code_quality>\r?\n/);
      expect(expandedTemplate).toContain("</code_quality>");
      if (template.includes("Rules:")) {
        expect(expandedTemplate).toContain("<code_quality>\r\nRules:\r\n");
      }
    } else {
      const prefix = template.slice(0, template.indexOf("Rules:") + "Rules:\r\n".length);
      expect(expandedTemplate.startsWith(`${COMMAND_SAFETY_BLOCK}\n\n${prefix}`)).toBe(true);
      expect(expandedTemplate.endsWith("\r\n\r\n")).toBe(true);
    }
  });

  it.each([
    ["skill input", { workflow: "skill/fixture", type: "skill/fixture", stdin: `${legacyPrefix}${legacyInput}` }],
    ["input with text after the closing tag", { stdin: `${legacyPrefix}${legacyInput}More task text` }],
    ["an inline marker", { stdin: `Quote {{enforcement}} here.\r\n\r\n${legacyInput}` }],
    ["an inline quoted empty section", { stdin: `Quote \`<code_quality></code_quality>\` here.\r\n\r\n${legacyInput}` }],
    ["a fenced empty section", { stdin: ["Rules:", "~~~xml", "<code_quality></code_quality>", "~~~", "", legacyInput].join("\r\n") }],
    ["ambiguous standalone empty sections", { stdin: `Rules:\r\n<code_quality></code_quality>\r\n<code_quality></code_quality>\r\n\r\n${legacyInput}` }],
    ["a code quality fixture without an enforcement slot", { stdin: `Keep <code_quality>example rules</code_quality>.\r\n\r\n${legacyInput}` }],
    ["identical prompt and stdin", { prompt: `${legacyPrefix}${legacyInput}`, stdin: `${legacyPrefix}${legacyInput}` }],
    ["an input block containing a marker section and nested input", { stdin: ` \r\n<user_input>\r\n${enforcementSection}\r\n${nestedInput}\r\n  Keep {{enforcement}}.  \r\n</user_input>\r\n` }],
    ["a scoped template with ambiguous marker sections", { stdin: `Rules:\r\n${enforcementSection}\r\n${enforcementSection}\r\n\r\n${legacyInput}` }],
    ["a scoped template with ambiguous bare markers", { stdin: `${legacyPrefix}{{enforcement}}\r\n\r\n${legacyInput}` }],
  ])("preserves %s in legacy Codex stdin", async (_label, task) => {
    const capturedStdin = mockAgentStdin();

    await dispatchToAgent({
      workflow: "gwrk-implement",
      workDir: "/fake/root",
      agent: "codex",
      quiet: true,
      ...task,
    });

    expect(capturedStdin()).toBe(`${COMMAND_SAFETY_BLOCK}\n\n${task.stdin}`);
    expect(skillRuntime.resolveEnforcementSkills).not.toHaveBeenCalled();
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

  it.each(['prompt', 'stdin'] as const)('preserves a code quality fixture in a legacy %s task', async (field) => {
    vi.mocked(skillRuntime.resolveEnforcementSkills).mockResolvedValue('# Strict Typing Rule');
    const capturedStdin = mockAgentStdin();
    const prompt = '  Keep this fixture:\r\n<code_quality>{{enforcement}}</code_quality>\r\n';

    await dispatchToAgent({
      workflow: 'gwrk-implement',
      workDir: '/fake/root',
      agent: 'agy',
      [field]: prompt,
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
  it("includes feature and task context in the native implementation agent stdin", async () => {
    const input = "Verify the idempotency guarantee.";
    const capturedStdin = mockAgentStdin();
    vi.mocked(extensionRuntime.resolveExtensionContext).mockImplementationOnce(
      async (_workDir, keywords) =>
        keywords?.includes("routing") && keywords.includes("idempotency")
          ? [{ source: "project_rules", content: "Use the durable operation key." }]
          : [],
    );

    await new WorkflowRuntime().executeWorkflow("gwrk-implement", input, {
      agent: "codex",
      featureDir: "specs/043-unified-routing-prompt-delivery",
      nativeOnly: true,
      projectRoot: "/fake/root",
    });

    expect(capturedStdin()).toContain("# /gwrk-implement");
    expect(capturedStdin()).toContain(`<user_input>\n${input}\n</user_input>`);
    expect(capturedStdin()).toContain("<project_rules>\nUse the durable operation key.\n</project_rules>");
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
