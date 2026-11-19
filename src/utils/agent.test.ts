/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchToAgent, SAFE_AGENT_ENV, COMMAND_SAFETY_BLOCK } from './agent.js';
import * as skillRuntime from '../plugins/skill-runtime.js';
import * as profileDetector from '../engine/profile-detector.js';
import * as extensionRuntime from '../plugins/extension-runtime.js';
import { WorkflowRuntime } from '../plugins/workflow-runtime.js';
import { resolveDesign } from '../domain/architecture-context.js';
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
vi.mock('../engine/profile-detector.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../engine/profile-detector.js')>(),
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

function mockAgentStdin(onSpawn?: () => void, stdout = '') {
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
      if (stdout) {
        child.stdout.write(`${stdout}\n`);
      }
      child.stdout.end();
      child.stderr.end();
      child.emit('close', 0);
    });
    return child as ReturnType<typeof spawn>;
  });
  return () => {
    if (!capturedStdin.startsWith('{"event":"user"')) return capturedStdin;
    return JSON.parse(capturedStdin).message.content as string;
  };
}

const legacyInput = "<user_input>\r\n  Keep {{enforcement}} and <code_quality></code_quality>.  \r\n</user_input>\r\n";

describe('US-016: Enforcement Skills Dispatch Injection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(skillRuntime.resolveEnforcementSkills).mockReset();
  });

  it("preserves the Antigravity input event through composed dispatch", async () => {
    const template = "Read the quoted \"spec\".\r\n";
    const userInput = "<user_input>\r\nKeep \\ paths and {{enforcement}}.\r\n</user_input>\r\n";
    const result = await dispatchToAgent({
      workflow: "gwrk-plan",
      workDir: "/fake/root",
      agent: "agy",
      stdin: template + "\n\n" + userInput,
      promptParts: { template, userInput },
      dryRun: true,
      quiet: true,
    });

    expect(JSON.parse(result.stdout)).toEqual({
      event: "user",
      message: { content: [COMMAND_SAFETY_BLOCK, template, userInput].join("\n\n") },
    });
    expect(result.stdout.split("\n").filter(Boolean)).toHaveLength(1);
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
      { architectureTarget: undefined, policyDirs: ['/fake/root'] },
    );
    expect(capturedStdin()).toContain('<code_quality>\n<effective_policy>\n# Strict Typing Rule\n</effective_policy>\n</code_quality>');
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

  const legacyPrefix = "Rules:\r\n{{enforcement}}\r\n\r\n";
  const enforcementSection = "<code_quality>\r\n{{enforcement}}\r\n</code_quality>";
  const nestedInput = "<user_input>\r\n  Nested example.  \r\n</user_input>";
  const inlineEnforcementExample = "Quote `<code_quality>{{enforcement}}</code_quality>` as written.\r\n";
  const blockQuoteEnforcementExample = "> <code_quality>{{enforcement}}</code_quality>\r\n";

  it.each([
    ["gwrk-implement", "{{enforcement}}"],
    ["gwrk-implement", "Rules:\r\n<code_quality>\r\n{{enforcement}}\r\n</code_quality>"],
    ["skill/fixture", "{{enforcement}}"],
    ["skill/fixture", "Rules:\r\n<code_quality>\r\n{{enforcement}}\r\n</code_quality>"],
  ])(
    "sends equal legacy enforcement input once for %s (%j)",
    async (workflow, marker) => {
      const capturedStdin = mockAgentStdin();
      const actualSkills = await vi.importActual<typeof skillRuntime>(
        "../plugins/skill-runtime.js",
      );
      vi.mocked(skillRuntime.resolveEnforcementSkills).mockImplementationOnce(
        actualSkills.resolveEnforcementSkills,
      );

      await dispatchToAgent({
        workflow,
        workDir: "/fake/root",
        agent: "codex",
        prompt: marker,
        stdin: marker,
        quiet: true,
      });

      const payload = capturedStdin();
      if (workflow.startsWith("skill/")) {
        expect(payload).toBe(`${COMMAND_SAFETY_BLOCK}\n\n${marker}`);
        expect(skillRuntime.resolveEnforcementSkills).not.toHaveBeenCalled();
      } else {
        expect(payload).not.toContain(marker);
        expect(payload.match(/<!-- enforcement-skill: typescript-standards -->/g))
          .toHaveLength(1);
        expect(skillRuntime.resolveEnforcementSkills).toHaveBeenCalledTimes(1);
      }
    },
  );

  it("expands a split legacy prompt and preserves its scoped stdin", async () => {
    const actualSkills = await vi.importActual<typeof skillRuntime>(
      "../plugins/skill-runtime.js",
    );
    vi.mocked(skillRuntime.resolveEnforcementSkills).mockImplementationOnce(
      actualSkills.resolveEnforcementSkills,
    );
    const capturedStdin = mockAgentStdin();

    await dispatchToAgent({
      workflow: "gwrk-implement",
      workDir: "/fake/root",
      agent: "codex",
      prompt: enforcementSection,
      stdin: legacyInput,
      quiet: true,
    });

    const prefix = `${COMMAND_SAFETY_BLOCK}\n\n<code_quality>\r\n`;
    const suffix = `\r\n</code_quality>\n\n${legacyInput}`;
    const payload = capturedStdin();
    expect(payload.slice(0, prefix.length)).toBe(prefix);
    expect(payload.slice(-suffix.length)).toBe(suffix);
    const rules = payload.slice(prefix.length, -suffix.length);
    expect(rules).toContain("<!-- enforcement-skill: typescript-standards -->");
    expect(rules).not.toContain("{{enforcement}}");
  });

  it.each([
    ["an assembled prompt with LF", "", "\n\n"],
    ["an assembled prompt with CRLF", "", "\r\n\r\n"],
    ["a distinct prompt and stdin", "Separate instructions.\n\n", "\n\n"],
  ])("preserves %s without duplicating instructions", async (_label, extra, separator) => {
    const capturedStdin = mockAgentStdin();
    const template = "UNIQUE_INSTRUCTIONS";
    const stdin = template + separator + legacyInput;

    await dispatchToAgent({
      workflow: "gwrk-implement",
      workDir: "/fake/root",
      agent: "codex",
      prompt: extra.trimEnd() || template,
      stdin,
      quiet: true,
    });

    expect(capturedStdin()).toBe(`${COMMAND_SAFETY_BLOCK}\n\n${extra}${stdin}`);
    expect(skillRuntime.resolveEnforcementSkills).not.toHaveBeenCalled();
  });

  it.each([
    ["section", enforcementSection],
    ["bare marker", "{{enforcement}}"],
  ])(
    "expands the scoped legacy empty slot after a fenced %s example",
    async (_label, fencedExample) => {
      const actualSkills = await vi.importActual<typeof skillRuntime>(
        "../plugins/skill-runtime.js",
      );
      vi.mocked(skillRuntime.resolveEnforcementSkills).mockImplementationOnce(
        actualSkills.resolveEnforcementSkills,
      );
      const capturedStdin = mockAgentStdin();
      const example = [
        "Example:",
        "~~~xml",
        fencedExample,
        "~~~",
        "Rules:",
        "",
      ].join("\r\n");
      const slot = "<code_quality></code_quality>";
      const suffix = `\r\n\r\n${legacyInput}`;

      await dispatchToAgent({
        workflow: "gwrk-implement",
        workDir: "/fake/root",
        agent: "codex",
        stdin: example + slot + suffix,
        quiet: true,
      });

      const payload = capturedStdin();
      const prefix = `${COMMAND_SAFETY_BLOCK}\n\n${example}<code_quality>\n`;
      const expandedSuffix = `\n</code_quality>${suffix}`;
      expect(payload.slice(0, prefix.length)).toBe(prefix);
      expect(payload.slice(-expandedSuffix.length)).toBe(expandedSuffix);
      expect(payload.slice(prefix.length, -expandedSuffix.length)).toContain(
        "<!-- enforcement-skill: typescript-standards -->",
      );
    },
  );

  const commentedExample = "<!-- <code_quality>{{enforcement}}</code_quality> -->\r\n";
  const commentedFence = ["<!--", "~~~xml", enforcementSection, "<user_input>", "-->", ""].join("\r\n");
  const indentedExample = "<code_quality>{{enforcement}}</code_quality>";
  const spaceIndentedExample = `    ${indentedExample}\r\n\r\n`;
  const tabIndentedExample = `\t${indentedExample}\r\n\r\n`;

  it.each([
    ["structured", "empty section", "Quote `<code_quality></code_quality>` as written.\r\n"],
    ["legacy", "empty section", "Quote `<code_quality></code_quality>` as written.\r\n"],
    ["structured", "marked section", inlineEnforcementExample],
    ["legacy", "marked section", inlineEnforcementExample],
    ["structured", "block quote", blockQuoteEnforcementExample],
    ["legacy", "block quote", blockQuoteEnforcementExample],
    ["structured", "HTML comment", commentedExample],
    ["legacy", "HTML comment", commentedExample],
    ["structured", "HTML comment with a fence", commentedFence],
    ["legacy", "HTML comment with a fence", commentedFence],
    ["structured", "four-space indented example", spaceIndentedExample],
    ["legacy", "four-space indented example", spaceIndentedExample],
    ["structured", "tab-indented example", tabIndentedExample],
    ["legacy", "tab-indented example", tabIndentedExample],
  ] as const)(
    "preserves the example before the enforcement slot in %s Codex stdin (%s)",
    async (transport, _label, example) => {
      const actualSkills = await vi.importActual<typeof skillRuntime>("../plugins/skill-runtime.js");
      vi.mocked(skillRuntime.resolveEnforcementSkills).mockImplementationOnce(actualSkills.resolveEnforcementSkills);
      const capturedStdin = mockAgentStdin();
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
    ["structured", "    ", ""],
    ["structured", "\t", ""],
    ["structured", "    ", "    Preserve this rule.  \r\n"],
    ["legacy", "    ", "    Preserve this rule.  \r\n"],
  ])("expands an indented active enforcement slot in %s stdin (%j, %j)", async (mode, indent, rulesLine) => {
    const actualSkills = await vi.importActual<typeof skillRuntime>("../plugins/skill-runtime.js");
    vi.mocked(skillRuntime.resolveEnforcementSkills).mockImplementationOnce(actualSkills.resolveEnforcementSkills);
    const capturedStdin = mockAgentStdin();
    const example = "    {{enforcement}}\r\n\r\n";
    const opening = example + "<code_quality>\r\n";
    const fencedExample = "~~~xml\r\n    {{enforcement}}\r\n~~~\r\n";
    const indentedBlock = "    An indented Markdown example:\r\n    {{enforcement}}\r\n\r\n";
    const closing = "\r\n</code_quality>";
    const beforeMarker = opening + indentedBlock + fencedExample + rulesLine + indent;
    const template = beforeMarker + "{{enforcement}}" + closing;

    await dispatchToAgent({
      workflow: "gwrk-implement",
      workDir: "/fake/root",
      agent: "codex",
      stdin: template + "\n\n" + legacyInput,
      promptParts: mode === "structured" ? { template, userInput: legacyInput } : undefined,
      quiet: true,
    });

    const payload = capturedStdin();
    const prefix = COMMAND_SAFETY_BLOCK + "\n\n" + beforeMarker;
    const suffix = closing + "\n\n" + legacyInput;
    expect(payload.startsWith(prefix)).toBe(true);
    expect(payload.endsWith(suffix)).toBe(true);
    expect(payload.slice(prefix.length, -suffix.length)).toContain(
      "<!-- enforcement-skill: typescript-standards -->",
    );
    expect(payload.slice(prefix.length, -suffix.length)).not.toContain("{{enforcement}}");
  });

  it("expands the unquoted marker inside a legacy section that also quotes the marker", async () => {
    const capturedStdin = mockAgentStdin();
    const example = "Quote ``{{enforcement}} with a single ` backtick``.\r\n";
    const prefix = `<code_quality>\r\n${example}`;
    const suffix = "\r\n</code_quality>";
    vi.mocked(skillRuntime.resolveEnforcementSkills).mockResolvedValueOnce("# Strict Typing Rule");

    await dispatchToAgent({
      workflow: "gwrk-implement",
      workDir: "/fake/root",
      agent: "codex",
      stdin: `${prefix}{{enforcement}}${suffix}`,
      quiet: true,
    });

    expect(capturedStdin()).toBe(`${COMMAND_SAFETY_BLOCK}\n\n${prefix}<effective_policy>\n# Strict Typing Rule\n</effective_policy>${suffix}`);
  });

  it.each([
    ["without surrounding whitespace", "", ""],
    ["with surrounding whitespace", "\r\n \t", " \t\r\n"],
  ])("expands a standalone legacy marker %s", async (_label, leading, trailing) => {
    const actualSkills = await vi.importActual<typeof skillRuntime>("../plugins/skill-runtime.js");
    vi.mocked(skillRuntime.resolveEnforcementSkills).mockImplementationOnce(actualSkills.resolveEnforcementSkills);
    const capturedStdin = mockAgentStdin();

    await dispatchToAgent({
      workflow: "gwrk-implement",
      workDir: "/fake/root",
      agent: "codex",
      stdin: `${leading}{{enforcement}}${trailing}`,
      quiet: true,
    });

    const payload = capturedStdin();
    const prefix = `${COMMAND_SAFETY_BLOCK}\n\n${leading}`;
    const rulesEnd = payload.length - trailing.length;
    expect(payload.slice(0, prefix.length)).toBe(prefix);
    expect(payload.slice(rulesEnd)).toBe(trailing);
    const rules = payload.slice(prefix.length, rulesEnd);
    expect(rules).toContain("<!-- enforcement-skill: typescript-standards -->");
    expect(rules).not.toContain("{{enforcement}}");
  });

  it.each([
    ["a standalone empty section", "<code_quality></code_quality>"],
    ["a standalone enforcement section", "<code_quality>\r\n{{enforcement}}\r\n</code_quality>"],
    ["a standalone enforcement section with surrounding rules", "<code_quality>\r\nRules:\r\n{{enforcement}}\r\n</code_quality>"],
    ["a bare marker after a block-quoted input opener", `Quoted opener:\r\n> <user_input>\r\n\r\n${legacyPrefix}${legacyInput}`],
    ["an empty section before scoped input", `Rules:\r\n<code_quality></code_quality>\r\n\r\n${legacyInput}`],
    ["a multiline empty section before scoped input", `Rules:\r\n<code_quality>\r\n</code_quality>\r\n\r\n${legacyInput}`],
    ["a code quality slot before scoped input", `Rules:\r\n<code_quality>\r\n{{enforcement}}\r\n</code_quality>\r\n\r\n${legacyInput}`],
    ["a code quality slot after a fenced input opener", `Quoted opener:\r\n~~~xml\r\n<user_input>\r\n~~~\r\n\r\nRules:\r\n<code_quality>\r\n{{enforcement}}\r\n</code_quality>\r\n\r\n${legacyInput}`],
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
    ["a standalone marker in skill input", { workflow: "skill/fixture", type: "skill/fixture", stdin: "{{enforcement}}" }],
    ["input with text after the closing tag", { stdin: `${legacyPrefix}${legacyInput}More task text` }],
    ["an inline marker", { stdin: `Quote {{enforcement}} here.\r\n\r\n${legacyInput}` }],
    ["an inline quoted empty section", { stdin: `Quote \`<code_quality></code_quality>\` here.\r\n\r\n${legacyInput}` }],
    ["an inline quoted enforcement section", { stdin: `${inlineEnforcementExample}\r\n${legacyInput}` }],
    ["a block-quoted enforcement section", { stdin: `${blockQuoteEnforcementExample}\r\n${legacyInput}` }],
    ["a bare marker in a multiline code span", { stdin: `Quote \`\`a single \` backtick\r\n{{enforcement}}\r\ninside the span\`\`.\r\n\r\n${legacyInput}` }],
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

  it.each([false, true])(
    "keeps a fenced opener within scoped legacy input with template enforcement %s",
    async (hasEnforcement) => {
      vi.mocked(skillRuntime.resolveEnforcementSkills).mockResolvedValueOnce("# Strict Typing Rule");
      const capturedStdin = mockAgentStdin();
      const template = hasEnforcement ? `Rules:\r\n${enforcementSection}` : "Rules:";
      const input = [
        "<user_input>",
        enforcementSection,
        "~~~xml",
        "<user_input>",
        "~~~",
        "Keep the fixture.",
        "</user_input>",
        "",
      ].join("\r\n");
      await dispatchToAgent({
        workflow: "gwrk-implement",
        workDir: "/fake/root",
        agent: "codex",
        stdin: template + "\r\n\r\n" + input,
        quiet: true,
      });

      const expectedTemplate = hasEnforcement
        ? template.replace("{{enforcement}}", "<effective_policy>\n# Strict Typing Rule\n</effective_policy>")
        : template;
      expect(capturedStdin()).toBe(
        `${COMMAND_SAFETY_BLOCK}\n\n${expectedTemplate}\r\n\r\n${input}`,
      );
      expect(skillRuntime.resolveEnforcementSkills).toHaveBeenCalledTimes(
        Number(hasEnforcement),
      );
    },
  );

  it("expands legacy enforcement before scoped input with an unclosed fence", async () => {
    const actualSkills = await vi.importActual<typeof skillRuntime>(
      "../plugins/skill-runtime.js",
    );
    vi.mocked(skillRuntime.resolveEnforcementSkills).mockImplementationOnce(
      actualSkills.resolveEnforcementSkills,
    );
    const capturedStdin = mockAgentStdin();
    const input = [
      "<user_input>",
      enforcementSection,
      "~~~text",
      "<user_input>",
      "  Keep the fixture.  ",
      "</user_input>",
      "",
    ].join("\r\n");

    await dispatchToAgent({
      workflow: "gwrk-implement",
      workDir: "/fake/root",
      agent: "codex",
      stdin: `Rules:\r\n${enforcementSection}\r\n\r\n${input}`,
      quiet: true,
    });

    const prefix = `${COMMAND_SAFETY_BLOCK}\n\nRules:\r\n<code_quality>\r\n`;
    const suffix = `\r\n</code_quality>\r\n\r\n${input}`;
    const payload = capturedStdin();
    expect(payload.slice(0, prefix.length)).toBe(prefix);
    expect(payload.slice(-suffix.length)).toBe(suffix);
    const rules = payload.slice(prefix.length, -suffix.length);
    expect(rules).toContain("<!-- enforcement-skill: typescript-standards -->");
    expect(rules).not.toContain("{{enforcement}}");
  });

  const inputWithLiteralOpener = [
    "<user_input>",
    enforcementSection,
    "<user_input>",
    "  Keep both opening tags.  ",
    "</user_input>",
    "",
  ].join("\r\n");

  it.each([
    ["without a template slot", "Rules:"],
    ["with an empty template slot", "Rules:\r\n<code_quality></code_quality>"],
    ["with a marked template slot", `Rules:\r\n${enforcementSection}`],
  ])("preserves ambiguous legacy stdin %s", async (_label, template) => {
    vi.mocked(skillRuntime.resolveEnforcementSkills).mockResolvedValueOnce("# Strict Typing Rule");
    const capturedStdin = mockAgentStdin();
    const stdin = `${template}\r\n\r\n${inputWithLiteralOpener}`;

    await dispatchToAgent({
      workflow: "gwrk-implement",
      workDir: "/fake/root",
      agent: "codex",
      stdin,
      quiet: true,
    });

    expect(capturedStdin()).toBe(`${COMMAND_SAFETY_BLOCK}\n\n${stdin}`);
    expect(skillRuntime.resolveEnforcementSkills).not.toHaveBeenCalled();
  });

  it("expands the explicit template before input with a literal opener", async () => {
    vi.mocked(skillRuntime.resolveEnforcementSkills).mockResolvedValueOnce("# Strict Typing Rule");
    const capturedStdin = mockAgentStdin();
    const template = `Rules:\r\n${enforcementSection}`;
    const userInput = inputWithLiteralOpener;

    await dispatchToAgent({
      workflow: "gwrk-implement",
      workDir: "/fake/root",
      agent: "codex",
      stdin: `${template}\n\n${userInput}`,
      promptParts: { template, userInput },
      quiet: true,
    });

    const expandedTemplate = template.replace("{{enforcement}}", "<effective_policy>\n# Strict Typing Rule\n</effective_policy>");
    expect(capturedStdin()).toBe(`${COMMAND_SAFETY_BLOCK}\n\n${expandedTemplate}\n\n${userInput}`);
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

    expect(capturedStdin()).toContain('<code_quality>\n<effective_policy>\n# Strict Typing Rule\n</effective_policy>\n</code_quality>');
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

    it.each([
      ["active", COMMAND_SAFETY_BLOCK, legacyInput, ""],
      ["fenced", `~~~text\n${COMMAND_SAFETY_BLOCK}\n~~~`, legacyInput, COMMAND_SAFETY_BLOCK],
      ["scoped input", "Do the work.", `<user_input>\r\n${COMMAND_SAFETY_BLOCK}\r\n</user_input>\r\n`, COMMAND_SAFETY_BLOCK],
    ])("sends an active policy in legacy stdin with an %s policy copy", async (_label, template, input, injectedPolicy) => {
      const capturedStdin = mockAgentStdin();
      const stdin = `${template}\n\n${input}`;

      await dispatchToAgent({
        workflow: "gwrk-implement",
        workDir: "/fake/root",
        agent: "codex",
        stdin,
        quiet: true,
      });

      expect(capturedStdin()).toBe([injectedPolicy, stdin].filter(Boolean).join("\n\n"));
      expect(skillRuntime.resolveEnforcementSkills).not.toHaveBeenCalled();
    });
  });

  describe('Layer 2: SAFE_AGENT_ENV', () => {
    it("injects command safety when a template contains only a commented copy", async () => {
      const capturedStdin = mockAgentStdin();
      const template = `<!--\n${COMMAND_SAFETY_BLOCK}\n-->\nDo the work.`;
      const userInput = "<user_input>\nImplement the change.\n</user_input>";

      await dispatchToAgent({
        workflow: "gwrk-implement",
        workDir: "/fake/root",
        agent: "codex",
        promptParts: { template, userInput },
        quiet: true,
      });

      expect(capturedStdin()).toBe(
        `${COMMAND_SAFETY_BLOCK}\n\n${template}\n\n${userInput}`,
      );
    });

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

async function withHermeticProjectRoot<T>(
  fn: (projectRoot: string) => Promise<T>,
): Promise<T> {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-hermetic-"));
  const actualSkillRuntime = await vi.importActual<
    typeof import("../plugins/skill-runtime.js")
  >("../plugins/skill-runtime.js");
  const actualProfileDetector = await vi.importActual<
    typeof import("../engine/profile-detector.js")
  >("../engine/profile-detector.js");

  try {
    fs.writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify({
        name: "fixture",
        devDependencies: { typescript: "^5.0.0" },
      }),
    );
    fs.mkdirSync(path.join(projectRoot, ".gwrk", "decisions"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(projectRoot, ".gwrk", "plugins.json"),
      JSON.stringify({ inherits: false }),
    );
    fs.writeFileSync(
      path.join(projectRoot, ".gwrk", "architecture.md"),
      "# Architecture Target\nHexagonal functional target.",
    );
    fs.writeFileSync(
      path.join(projectRoot, ".gwrk", "decisions", "index.md"),
      "# Architecture Decision Index\n\n| ADR | Scope | Status | Constraint |\n|---|---|---|---|\n| ADR-008 | Agent execution | Decided | Run non-interactively. |\n",
    );

    vi.mocked(skillRuntime.resolveEnforcementSkills).mockImplementation(
      actualSkillRuntime.resolveEnforcementSkills,
    );
    vi.mocked(profileDetector.detectProfile).mockImplementation(
      actualProfileDetector.detectProfile,
    );

    return await fn(projectRoot);
  } finally {
    vi.mocked(skillRuntime.resolveEnforcementSkills).mockReset();
    vi.mocked(profileDetector.detectProfile).mockReset();
    vi.mocked(profileDetector.detectProfile).mockResolvedValue({
      type: "nodejs",
      stack: { language: "TypeScript" },
      layout: "flat",
    });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
}

describe("TR-012: Captured Planning and Implementation Workflow Seam Tests", () => {
  it("captures spawned stdin for gwrk-plan with expanded enforcement, grounding, and single policy", async () => {
    const input = "Plan the requested phase.";
    const capturedStdin = mockAgentStdin(undefined, '{"summary":"ok","intents":[]}');

    await withHermeticProjectRoot(async (projectRoot) => {
      await new WorkflowRuntime().executeWorkflow("gwrk-plan", input, {
        agent: "codex",
        featureDir: "specs/043-unified-routing-prompt-delivery",
        projectRoot,
        quiet: true,
      });

      const stdin = capturedStdin();
      const inputBoundary = stdin.indexOf("<user_input>");
      expect(inputBoundary).toBeGreaterThan(-1);
      const templatePrefix = stdin.slice(0, inputBoundary);

      expect(templatePrefix).toContain("<code_quality>");
      expect(templatePrefix).toContain(
        "<!-- enforcement-skill: typescript-standards -->",
      );
      expect(templatePrefix).not.toContain("{{enforcement}}");
      expect(templatePrefix).not.toContain("undefined");

      expect(stdin).toContain("<architecture_target>");
      expect(stdin).toContain("<architecture_decisions>");

      expect(stdin.split(COMMAND_SAFETY_BLOCK).length - 1).toBe(1);
      expect(stdin.match(/<command_safety>/g)).toHaveLength(1);

      expect(stdin.match(/# \/gwrk-plan/g)).toHaveLength(1);
      expect(stdin.match(/<user_input>/g)).toHaveLength(1);
      expect(stdin).toContain(`<user_input>\n${input}\n</user_input>`);
    });
  });

  it("captures spawned stdin for native gwrk-implement with expanded enforcement, grounding, and single policy", async () => {
    const input = "Implement the requested phase.";
    const capturedStdin = mockAgentStdin(undefined, '{"summary":"ok","intents":[]}');

    await withHermeticProjectRoot(async (projectRoot) => {
      await new WorkflowRuntime().executeWorkflow("gwrk-implement", input, {
        agent: "codex",
        featureDir: "specs/043-unified-routing-prompt-delivery",
        nativeOnly: true,
        projectRoot,
        quiet: true,
      });

      const stdin = capturedStdin();
      const inputBoundary = stdin.indexOf("<user_input>");
      expect(inputBoundary).toBeGreaterThan(-1);
      const templatePrefix = stdin.slice(0, inputBoundary);

      expect(templatePrefix).toContain("<code_quality>");
      expect(templatePrefix).toContain(
        "<!-- enforcement-skill: typescript-standards -->",
      );
      expect(templatePrefix).not.toContain("{{enforcement}}");
      expect(templatePrefix).not.toContain("undefined");

      expect(stdin).toContain("<architecture_target>");
      expect(stdin).toContain("<architecture_decisions>");

      expect(stdin.split(COMMAND_SAFETY_BLOCK).length - 1).toBe(1);
      expect(stdin.match(/<command_safety>/g)).toHaveLength(1);

      expect(stdin.match(/# \/gwrk-implement/g)).toHaveLength(1);
      expect(stdin.match(/<user_input>/g)).toHaveLength(1);
      expect(stdin).toContain(`<user_input>\n${input}\n</user_input>`);
    });
  });
});

describe("Phase 4: Effective policy in built-in workflow stdin", () => {
  it("delivers definition policy in gwrk-specify and preserves the user input", async () => {
    const input = "Specify the policy change. Keep {{enforcement}} in this description.";
    const capturedStdin = mockAgentStdin(undefined, '{"summary":"ok","intents":[]}');

    await withHermeticProjectRoot(async (projectRoot) => {
      for (const scope of ["define", "implementation"]) {
        const name = `fixture-${scope}-policy`;
        const directory = path.join(projectRoot, ".gwrk/plugins/skills", name);
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(
          path.join(directory, "manifest.yaml"),
          `type: skill\nname: ${name}\nversion: 1.0.0\ndescription: Fixture policy\ntier: enforcement\nscope: ${scope}\n`,
        );
        fs.writeFileSync(path.join(directory, "SKILL.md"), `Fixture policy for ${scope}.\n`);
      }

      await new WorkflowRuntime().executeWorkflow("gwrk-specify", input, {
        agent: "codex",
        profile: { type: "app" },
        projectRoot,
        quiet: true,
      });

      const stdin = capturedStdin();
      const policy = stdin.match(/<effective_policy>[\s\S]*?<\/effective_policy>/g) ?? [];
      expect(policy).toHaveLength(1);
      expect(stdin).toContain(`<code_quality>\n${policy[0]}\n</code_quality>`);
      expect(policy[0].match(/<!-- enforcement-skill: [^>]+ -->/g)).toEqual([
        "<!-- enforcement-skill: fixture-define-policy -->",
      ]);
      expect(policy[0]).toContain("Fixture policy for define.");
      expect(stdin).not.toContain("fixture-implementation-policy");
      expect(stdin).toContain(`<user_input>\n${input}\n</user_input>`);
    });
  });

  it("delivers the target rule once in gwrk-implement and keeps the selected skill and gap", async () => {
    const capturedStdin = mockAgentStdin();
    const rule = "Domain policy MUST depend inward";

    await withHermeticProjectRoot(async (projectRoot) => {
      fs.writeFileSync(
        path.join(projectRoot, ".gwrk/architecture.md"),
        `# Project architecture target\n\n## Rules\n\n- ${rule}. Ports declare boundaries. Adapters implement effects. Composition wires dependencies.\n\n## Framework guidance\n\nNo framework selected.\n`,
      );

      await new WorkflowRuntime().executeWorkflow("gwrk-implement", "Implement the change.", {
        agent: "codex",
        nativeOnly: true,
        profile: {
          type: "nodejs",
          stack: { language: "TypeScript", framework: "Django" },
          design: resolveDesign({ architecture: "hexagonal-functional" }),
        },
        projectRoot,
        quiet: true,
      });

      const stdin = capturedStdin();
      const target = stdin.match(/<architecture_target>([\s\S]*?)<\/architecture_target>/)?.[1];
      const policy = stdin.match(/<effective_policy>([\s\S]*?)<\/effective_policy>/)?.[1];
      expect(stdin.split(rule)).toHaveLength(2);
      expect(target).toContain(rule);
      expect(policy).toContain("Domain code MUST NOT access external state");
      expect(policy).toContain("<!-- enforcement-skill: typescript-standards -->");
      expect(policy).toContain("No compatible policy found for framework Django.");
    });
  });
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

    await withHermeticProjectRoot(async (projectRoot) => {
      await new WorkflowRuntime().executeWorkflow("gwrk-implement", input, {
        agent: "codex",
        featureDir: "specs/043-unified-routing-prompt-delivery",
        nativeOnly: true,
        projectRoot,
      });

      expect(capturedStdin()).toContain("# /gwrk-implement");
      expect(capturedStdin()).toContain(`<user_input>\n${input}\n</user_input>`);
      expect(capturedStdin()).toContain("<project_rules>\nUse the durable operation key.\n</project_rules>");
      expect(capturedStdin()).not.toContain("<code_quality>\nundefined\n</code_quality>");
    });
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
