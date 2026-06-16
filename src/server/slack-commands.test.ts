/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Module does not exist yet (RED)
 */
import { type Mocked, beforeEach, describe, expect, it, vi } from "vitest";
import type { DispatchQueue } from "./dispatch.js";
import type { GitManager } from "./git-manager.js";
import type { SystemMonitor } from "./monitor.js";
import { type CommandContext, handleSlashCommand } from "./slack-commands.js";

// Mock findOpenPr for approve command
vi.mock("../db/runs.js", () => ({
  findOpenPr: vi.fn().mockReturnValue({
    pr_number: 42,
    pr_url: "https://github.com/test/pr/42",
  }),
  listRuns: vi.fn().mockReturnValue([]),
  getStats: vi.fn().mockReturnValue([]),
}));

// Mock execSync for gh pr merge
vi.mock("node:child_process", async (importOriginal) => {
  const mod = await importOriginal<typeof import("node:child_process")>();
  return {
    ...mod,
    execSync: vi.fn().mockReturnValue("Merged PR #42"),
    spawn: vi.fn().mockReturnValue({ unref: vi.fn() }),
  };
});

// Mock resolveFeature to pass through
vi.mock("../utils/resolve-feature.js", () => ({
  resolveFeature: vi.fn().mockImplementation((input: string) => input),
}));

describe("slack-commands (FR-015, US-004)", () => {
  let mockQueue: Mocked<DispatchQueue>;
  let mockMonitor: Mocked<SystemMonitor>;
  let mockGit: Mocked<GitManager>;
  let context: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQueue = {
      getQueue: vi.fn().mockReturnValue({
        active: [],
        queued: [],
        throttled: false,
        paused: false,
      }),
      getDispatch: vi.fn(),
      enqueue: vi.fn(),
      pause: vi.fn(),
    } as unknown as Mocked<DispatchQueue>;
    mockMonitor = {
      getResources: vi.fn().mockReturnValue({
        cpuPercent: 10,
        memPercent: 20,
        diskFreeGb: 100,
      }),
    } as unknown as Mocked<SystemMonitor>;
    mockGit = {
      mergePhaseBack: vi.fn(),
    } as unknown as Mocked<GitManager>;

    context = {
      userId: "U123",
      channelId: "C123",
      projectRoot: "/tmp",
      buildServerUrl: "http://localhost:3000",
      queue: mockQueue,
      monitor: mockMonitor,
      git: mockGit,
    };
  });

  it("handles status command without args", async () => {
    const response = await handleSlashCommand("status", context);
    expect(response.response_type).toBe("ephemeral");
    expect(response.blocks[0].text.text).toMatch(
      /\*System Resources:\* CPU 10(\.0)?%, MEM 20(\.0)?%/,
    );
  });

  it("handles status command with feature ID", async () => {
    mockQueue.getDispatch.mockReturnValue({
      featureId: "003-slack",
      status: "running",
      phaseId: "phase-04",
    });
    const response = await handleSlashCommand("status 003-slack", context);
    expect(response.blocks[1].text.text).toContain(
      "*Feature 003-slack:* running (phase-04)",
    );
  });

  it("handles dispatch command with feature and phase", async () => {
    const response = await handleSlashCommand("dispatch 003-slack 3", context);
    expect(response.response_type).toBe("in_channel");
    expect(response.blocks[0].text.text).toContain(
      "Dispatching feature *003-slack*",
    );
    expect(mockQueue.enqueue).toHaveBeenCalledWith({
      featureId: "003-slack",
      phaseId: "phase-03",
    });
  });

  it("handles approve command — calls gh pr merge with PR from runs", async () => {
    const { execSync } = await import("node:child_process");
    const response = await handleSlashCommand(
      "approve 003-slack phase-01",
      context,
    );
    expect(response.response_type).toBe("in_channel");
    expect(response.blocks[0].text.text).toContain("PR #42");
    expect(execSync).toHaveBeenCalledWith(
      "gh pr merge 42 --merge --delete-branch",
      expect.objectContaining({ cwd: "/tmp" }),
    );
  });

  it("handles ship command — spawns background process", async () => {
    const { spawn } = await import("node:child_process");
    const response = await handleSlashCommand("ship 003-slack 1", context);
    expect(response.response_type).toBe("in_channel");
    expect(response.blocks[0].text.text).toContain("Dispatching *003-slack*");
    expect(spawn).toHaveBeenCalledWith(
      "gwrk",
      ["ship", "003-slack", "1"],
      expect.objectContaining({ cwd: "/tmp", detached: true }),
    );
  });

  it("handles define command — spawns background process (FR-015)", async () => {
    const { spawn } = await import("node:child_process");
    const response = await handleSlashCommand("define 003-slack", context);
    expect(response.response_type).toBe("in_channel");
    expect(response.blocks[0].text.text).toContain("define spec");
    expect(spawn).toHaveBeenCalledWith(
      "gwrk",
      ["define", "spec", "003-slack"],
      expect.objectContaining({ cwd: "/tmp", detached: true }),
    );
  });

  it("handles define subcommand (plan) — spawns background process (FR-015)", async () => {
    const { spawn } = await import("node:child_process");
    const response = await handleSlashCommand("define 003-slack plan", context);
    expect(response.response_type).toBe("in_channel");
    expect(response.blocks[0].text.text).toContain("define plan");
    expect(spawn).toHaveBeenCalledWith(
      "gwrk",
      ["define", "plan", "003-slack"],
      expect.objectContaining({ cwd: "/tmp", detached: true }),
    );
  });

  it("handles define with invalid subcommand — returns usage", async () => {
    const response = await handleSlashCommand(
      "define 003-slack unknown",
      context,
    );
    expect(response.response_type).toBe("ephemeral");
    expect(response.blocks[0].text.text).toContain("Invalid define subcommand");
  });

  it("handles pause command without args", async () => {
    const response = await handleSlashCommand("pause", context);
    expect(mockQueue.pause).toHaveBeenCalled();
    expect(response.blocks[0].text.text).toContain("Dispatch queue paused");
  });

  it("returns help for empty command", async () => {
    const response = await handleSlashCommand("", context);
    expect(response.blocks[0].text.text).toContain("gwrk");
    const helpText = response.blocks[1].text.text;
    expect(helpText).toContain("ship");
    expect(helpText).toContain("define");
  });

  it("returns error for unknown command", async () => {
    const response = await handleSlashCommand("unknown", context);
    expect(response.blocks[0].text.text).toContain(
      "Unknown command: `unknown`",
    );
  });
});
