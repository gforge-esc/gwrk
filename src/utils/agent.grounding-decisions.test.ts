/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * 029 Decision Records — RED tests for TR-008 (FR-013).
 *
 * @phase 06
 * @status active
 *
 * `dispatchToAgent({ dryRun: true })` returns the fully assembled stdin payload
 * (agent.ts:621), so the grounding block is asserted without spawning an agent.
 * Each case runs against its own temp `workDir`, so the suite is hermetic and
 * needs no GWRK_SKIP_INTEGRATION quarantine entry.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchToAgent } from "./agent.js";

vi.mock("../plugins/skill-runtime.js", () => ({
  resolveEnforcementSkills: vi.fn().mockResolvedValue(""),
}));
vi.mock("../plugins/extension-runtime.js", () => ({
  resolveExtensionContext: vi.fn().mockResolvedValue([]),
}));
vi.mock("../engine/profile-detector.js", () => ({
  detectProfile: vi.fn().mockResolvedValue({
    type: "nodejs",
    stack: { language: "TypeScript" },
    layout: "flat",
  }),
}));
vi.mock("./config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    agents: { throttleMs: 0, define: "agy", implement: "agy" },
  }),
}));

/**
 * Ids assembled from parts on purpose: FR-024 assertion 1 treats every bare
 * `ADR-NNN` under `src/` as a citation that MUST resolve, and these fixtures
 * name records that deliberately do not exist. Interpolating keeps
 * `gwrk define adr --check` from reading a fixture as a real citation.
 */
const adr = (n: string) => `ADR-${n}`;

const INDEX_BODY = [
  "# Architecture Decisions",
  "",
  "Recorded decisions. Read the Constraint column before writing code.",
  "",
  "| ADR | Scope | Status | Constraint |",
  "|---|---|---|---|",
  "| ADR-007 | gwrk dispatch architecture | Proposed | Code MUST NOT spawn an agent CLI directly. |",
  "",
  "<!-- hash: 0badc0de -->",
].join("\n");

let workDir: string;

function indexPath(root: string): string {
  return path.join(root, ".gwrk", "decisions", "index.md");
}

function writeIndexFixture(root: string, body = INDEX_BODY): void {
  mkdirSync(path.dirname(indexPath(root)), { recursive: true });
  writeFileSync(indexPath(root), body);
}

/** Collect everything written to stdout while a dispatch runs. */
function captureStdout(): () => string[] {
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(
    (chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    },
  );
  return () => writes;
}

async function assembledPrompt(
  root: string,
  workflow = "gwrk-implement",
): Promise<string> {
  const result = await dispatchToAgent({
    workflow,
    workDir: root,
    agent: "agy",
    stdin: "TASK PROMPT",
    dryRun: true,
    quiet: true,
  });
  expect(result.exitCode).toBe(0);
  return result.stdout;
}

beforeEach(() => {
  vi.clearAllMocks();
  workDir = mkdtempSync(path.join(tmpdir(), "gwrk-adr-grounding-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("029 FR-013: every dispatch learns what it may not do (US-004)", () => {
  it("FR-013: injects architecture_decisions when the index exists", async () => {
    writeIndexFixture(workDir);

    const prompt = await assembledPrompt(workDir);

    expect(prompt).toContain("<architecture_decisions>");
    expect(prompt).toContain("</architecture_decisions>");
    expect(prompt).toContain("| ADR | Scope | Status | Constraint |");
    expect(prompt).toContain("Code MUST NOT spawn an agent CLI directly.");
    // The tag wraps the file's content, and the task prompt still arrives.
    const block = prompt.slice(
      prompt.indexOf("<architecture_decisions>"),
      prompt.indexOf("</architecture_decisions>"),
    );
    expect(block).toContain(INDEX_BODY);
    expect(prompt).toContain("TASK PROMPT");
  });

  it("FR-013: skips silently when the index is absent", async () => {
    const writes = captureStdout();

    try {
      // `quiet: false` so a warning would be observable if one were printed.
      const result = await dispatchToAgent({
        workflow: "gwrk-implement",
        workDir,
        agent: "agy",
        stdin: "TASK PROMPT",
        dryRun: true,
      });

      // TC-016 fail-open: missing → skipped, no warning. Detection of absence
      // belongs to `--reindex --check`, not to dispatch.
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain("architecture_decisions");
      expect(result.stdout).toContain("TASK PROMPT");
      expect(writes().join("")).not.toContain("architecture_decisions");
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("FR-013: dispatch continues when the index is unreadable", async () => {
    // A directory at the index path: existsSync passes, the read throws.
    mkdirSync(indexPath(workDir), { recursive: true });
    const writes = captureStdout();

    try {
      const result = await dispatchToAgent({
        workflow: "gwrk-implement",
        workDir,
        agent: "agy",
        stdin: "TASK PROMPT",
        dryRun: true,
      });

      // Unreadable → dim warning, dispatch continues. Exactly as the three
      // existing grounding rows behave.
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("TASK PROMPT");
      expect(result.stdout).not.toContain("<architecture_decisions>");
      expect(writes().join("")).toMatch(/architecture_decisions.*unreadable/s);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("FR-013: injects uniformly, with no stage or scope filter", async () => {
    writeIndexFixture(workDir);

    // SC-004: IMPLEMENT and all four review stages receive it — they carry
    // zero decision references today. TC-009 forbids a per-stage gate.
    const stages = [
      "gwrk-implement",
      "gwrk-review-architecture",
      "gwrk-review-code",
      "gwrk-review-security",
      "gwrk-review-ux",
    ];
    const blocks: string[] = [];
    for (const stage of stages) {
      const prompt = await assembledPrompt(workDir, stage);
      const start = prompt.indexOf("<architecture_decisions>");
      const end = prompt.indexOf("</architecture_decisions>");
      expect(start, `stage ${stage} received no decisions`).toBeGreaterThan(-1);
      blocks.push(prompt.slice(start, end));
    }

    expect(new Set(blocks).size).toBe(1);
  });

  it("FR-013: the grounding array carries exactly four entries and no scope filter", async () => {
    // Asserted on the source so a scope or stage filter cannot be introduced
    // later without this failing (contract §4). `resolveEnforcementSkills`
    // takes (projectRoot, scope, profile); the grounding loop must not.
    const source = readFileSync(
      fileURLToPath(new URL("./agent.ts", import.meta.url)),
      "utf-8",
    );
    const start = source.indexOf("const groundingFiles");
    expect(start).toBeGreaterThan(-1);
    const literal = source.slice(start, source.indexOf("];", start) + 2);

    expect(literal.match(/\btag:/g)).toHaveLength(4);
    expect(literal).toContain("architecture_decisions");
    expect(literal).toContain(".gwrk/decisions/index.md");
    expect(literal).not.toMatch(/\bscope\b/);
    expect(literal).not.toMatch(/\bstage\b/);
  });

  it("FR-013: the index is read from workDir, not the process working directory", async () => {
    const other = mkdtempSync(path.join(tmpdir(), "gwrk-adr-grounding-other-"));
    try {
      writeIndexFixture(
        other,
        `| ADR | Scope | Status | Constraint |\n| ${adr("999")} | x | Decided | y |`,
      );

      const prompt = await assembledPrompt(workDir);

      // The worktree's own index is what a worktree dispatch must receive.
      expect(prompt).not.toContain(adr("999"));
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});
