/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { exec } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execAsync = promisify(exec);

const CLI_PATH = path.resolve(process.cwd(), "dist/cli.js");

async function runCli(
  args: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execAsync(`node ${CLI_PATH} ${args}`);
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout || "",
      stderr: e.stderr || "",
      exitCode: e.code || 1,
    };
  }
}

describe("CLI E2E Integration (UI / Command Surface)", () => {
  it("shows exactly the settled hierarchy on --help (US-018)", async () => {
    const { stdout, exitCode } = await runCli("--help");
    expect(exitCode).toBe(0);

    // Branding and Headers
    expect(stdout).toMatch(/🦩 gwrk/);
    expect(stdout).toMatch(/Foxtrot Charlie/);
    expect(stdout).toMatch(/Operations/);

    // Foxtrot Charlie pillars must be present
    expect(stdout).toMatch(/^\s+define\s+/m);
    expect(stdout).toMatch(/^\s+ship\s+/m);
    expect(stdout).toMatch(/^\s+measure\s+/m);

    // Core operational commands must be present
    expect(stdout).toMatch(/^\s+init\s+/m);
    expect(stdout).toMatch(/^\s+tasks\s+/m);
    expect(stdout).toMatch(/^\s+db\s+/m);
    expect(stdout).toMatch(/^\s+server\s+/m);
    expect(stdout).toMatch(/^\s+status\s+/m);
    expect(stdout).toMatch(/^\s+plan\s+/m);

    // Eliminated / Hidden — must NOT appear as top-level in help
    const hidden = [
      "run",
      "metrics",
      "implement",
      "specify",
      "analyze",
      "effort",
      "pulse",
      "compression",
      "new",
      "record",
    ];
    for (const cmd of hidden) {
      const regex = new RegExp(`^\\s+${cmd}\\b`, "m");
      expect(
        stdout,
        `Command ${cmd} should not be in top-level help`,
      ).not.toMatch(regex);
    }
  });

  it("gwrk define --help shows settled hierarchy (US-018)", async () => {
    const { stdout, exitCode } = await runCli("define --help");
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^\s+spec\b/m);
    expect(stdout).toMatch(/^\s+plan\b/m);
    expect(stdout).toMatch(/^\s+tasks\b/m);

    // No other subcommands
    const hidden = ["analyze", "specify", "generate", "implement", "ship"];
    for (const cmd of hidden) {
      const regex = new RegExp(`^\\s+${cmd}\\b`, "m");
      expect(stdout).not.toMatch(regex);
    }
  });

  it("gwrk ship --help shows settled hierarchy (US-018)", async () => {
    const { stdout, exitCode } = await runCli("ship --help");
    expect(exitCode).toBe(0);
    // Ship is now a standalone command with options, no subcommands
    expect(stdout).toMatch(/--dry-run/);
    expect(stdout).toMatch(/--max-iterations/);
    expect(stdout).toMatch(/--ci-timeout/);

    // No subcommands should exist
    const hidden = ["implement", "done", "run", "start"];
    for (const cmd of hidden) {
      const regex = new RegExp(`^\\s+${cmd}\\b`, "m");
      expect(stdout).not.toMatch(regex);
    }
  });

  it("gwrk measure --help shows settled hierarchy (US-018)", async () => {
    const { stdout, exitCode } = await runCli("measure --help");
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^\s+pulse\b/m);
    expect(stdout).toMatch(/^\s+compression\b/m);

    // No other subcommands
    const hidden = ["effort", "metrics", "status", "runs", "stats"];
    for (const cmd of hidden) {
      const regex = new RegExp(`^\\s+${cmd}\\b`, "m");
      expect(stdout).not.toMatch(regex);
    }
  });

  it("gwrk db --help shows settled hierarchy (US-018)", async () => {
    const { stdout, exitCode } = await runCli("db --help");
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^\s+runs\b/m);
    expect(stdout).toMatch(/^\s+stats\b/m);

    // record should be hidden
    expect(stdout).not.toMatch(/^\s+record\b/m);
  });

  it("gwrk tasks --help shows settled hierarchy (US-005, US-006, US-020)", async () => {
    const { stdout, exitCode } = await runCli("tasks --help");
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^\s+list\b/m);
    expect(stdout).toMatch(/^\s+next\b/m);
    expect(stdout).toMatch(/^\s+done\b/m);
    expect(stdout).toMatch(/^\s+verify\b/m);
  });

  it("fails gracefully with correct error when spec is missing", async () => {
    // 099-drift-test exists as a feature dir but has no spec.md
    const { stderr, exitCode } = await runCli("define plan 099");
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/Feature not found|BLOCKED.*spec\.md not found/);
  }, 15_000);
});

/**
 * 029 Decision Records — RED tests for TR-010 (FR-001).
 *
 * @phase 02
 * @status active
 *
 * `adr` is absent from the `hidden` list `["analyze","specify","generate",
 * "implement","ship"]` that `define --help` asserts above, so the existing
 * assertion passes untouched — asserting `adr` positively is the deliberate
 * move rather than an incidental pass. Spawns the built CLI, so `pnpm run
 * build` must run first (VR-001, TC-012).
 */
describe("029 TR-010: define adr on the built CLI (US-001, US-018)", () => {
  it("FR-001: adr appears in define --help (US-018)", async () => {
    const { stdout, exitCode } = await runCli("define --help");
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^\s+adr\b/m);
  });

  it("FR-001: define adr --help carries an Examples: block (US-018)", async () => {
    const { stdout, exitCode } = await runCli("define adr --help");
    expect(exitCode).toBe(0);
    // Pin the usage line first: without it, an unknown subcommand falls back to
    // the PARENT `define` help, which already carries an Examples: block — so
    // the assertion would pass before `adr` exists.
    expect(stdout).toMatch(/Usage:.*define adr/);
    expect(stdout).toMatch(/Examples:/i);
  });

  it("FR-008: define adr --help declares neither --refs nor --dry-run", async () => {
    const { stdout } = await runCli("define adr --help");
    // TC-013: the dry-run affordance is `--print`, so the nine-entry collision
    // baseline holds with no allowlist entry.
    expect(stdout).not.toMatch(/--refs\b/);
    expect(stdout).not.toMatch(/--dry-run\b/);
    expect(stdout).toMatch(/--print\b/);
  });

  it("FR-001: define adr --print exits 0 and emits the ADR-004 signal line", async () => {
    const { stdout, stderr, exitCode } = await runCli("define adr --print");
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^# ADR-\d{3}: /m);
    // ADR-004: withSignal emits the `[exit:N | Xs]` line on stderr. D12 records
    // that `define research` skips it; FR-001 forbids copying that omission.
    expect(stderr).toMatch(/\[exit:0 \| .+\]/);
  });
});
