/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  type Mock,
  type Mocked,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { GwrkConfig } from "../utils/config.js";
import { LocalInvocationStrategy } from "./backends/invocation-strategy.js";
import { DispatchOrchestrator } from "./dispatch-orchestrator.js";
import { SandboxManager } from "./sandbox.js";

vi.mock("./sandbox.js");
vi.mock("./backends/invocation-strategy.js");

describe("DispatchOrchestrator", () => {
  let orchestrator: DispatchOrchestrator;
  let mockSandbox: Mocked<SandboxManager>;
  let mockInvocation: Mocked<LocalInvocationStrategy>;

  const mockConfig: GwrkConfig = {
    project: { name: "test" },
    agents: { define: "gemini", implement: "gemini" },
    server: {
      port: 18790,
      host: "localhost",
      heartbeatIntervalMs: 1000,
      networkCheckIntervalMs: 1000,
    },
    parallelism: {
      local: { maxCpu: 80, maxMem: 80, minDiskGb: 10, maxClones: 2 },
      cloud: { maxConcurrent: 10 },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSandbox = new SandboxManager() as Mocked<SandboxManager>;
    mockInvocation =
      new LocalInvocationStrategy() as Mocked<LocalInvocationStrategy>;
    orchestrator = new DispatchOrchestrator(
      mockConfig,
      mockSandbox,
      mockInvocation,
    );
  });

  it("FR-001: should dispatch multiple tasks concurrently up to maxConcurrency", async () => {
    let active = 0;
    let maxActive = 0;

    mockSandbox.createSandbox.mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 50));
      return "/work/dir";
    });

    mockSandbox.destroySandbox.mockImplementation(async () => {
      active--;
    });

    mockInvocation.invoke.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationS: 0,
    });

    const tasks = [
      { id: "T1", prompt: "Task 1" },
      { id: "T2", prompt: "Task 2" },
      { id: "T3", prompt: "Task 3" },
    ];

    const results = await orchestrator.dispatchPhase({
      featureId: "f1",
      phaseId: "p1",
      tasks,
      concurrency: 2,
    });

    expect(results).toHaveLength(3);
    expect(maxActive).toBe(2);
    expect(results.every((r) => r.status === "completed")).toBe(true);
  });

  it("FR-004: should handle capacity gating and wait in queue", async () => {
    mockInvocation.invoke.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationS: 0,
    });

    const tasks = Array.from({ length: 5 }, (_, i) => ({
      id: `T${i}`,
      prompt: `Task ${i}`,
    }));

    // With concurrency 1, it should process them sequentially
    const results = await orchestrator.dispatchPhase({
      featureId: "f1",
      phaseId: "p1",
      tasks,
      concurrency: 1,
    });

    expect(results).toHaveLength(5);
    expect(mockSandbox.createSandbox).toHaveBeenCalledTimes(5);
  });

  it("FR-004: should timeout if tasks stay in queue for too long", async () => {
    // Inject a small timeout for testing
    // biome-ignore lint/suspicious/noExplicitAny: Testing private property
    (orchestrator as any).queueTimeoutMs = 100;

    mockSandbox.createSandbox.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return "/work/dir";
    });

    mockInvocation.invoke.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationS: 0,
    });

    const tasks = [
      { id: "T1", prompt: "Task 1" },
      { id: "T2", prompt: "Task 2" },
      { id: "T3", prompt: "Task 3" },
    ];

    const results = await orchestrator.dispatchPhase({
      featureId: "f1",
      phaseId: "p1",
      tasks,
      concurrency: 1,
    });

    // Only T1 should be running (and then fail due to timeout in runNext check or finally complete)
    // Actually, runNext checks Date.now() - startTime > queueTimeoutMs before doing anything.
    // T1 starts, takes 200ms.
    // T2 tries to start, but check fails.
    expect(
      results.some(
        (r) =>
          r.status === "failed" &&
          // biome-ignore lint/suspicious/noExplicitAny: Dynamic testing assignment
          (r as any).result?.stderr === "Agent capacity queue timeout",
      ),
    ).toBe(true);
  });

  it("should mark task as failed if invocation fails", async () => {
    mockInvocation.invoke.mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "error",
      durationS: 0,
    });

    const results = await orchestrator.dispatchPhase({
      featureId: "f1",
      phaseId: "p1",
      tasks: [{ id: "T1" }],
    });

    expect(results[0].status).toBe("failed");
    // biome-ignore lint/suspicious/noExplicitAny: Dynamic testing assignment
    expect((results[0] as any).result?.exitCode).toBe(1);
  });

  it("FR-005: should retry on 429 rate limit error", async () => {
    // Mock throttle to speed up test
    vi.spyOn(orchestrator, "throttle").mockResolvedValue(undefined);

    mockInvocation.invoke
      .mockResolvedValueOnce({
        exitCode: 429,
        stdout: "",
        stderr: "rate limit exceeded",
        durationS: 0,
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "success",
        stderr: "",
        durationS: 0,
      });

    const results = await orchestrator.dispatchPhase({
      featureId: "f1",
      phaseId: "p1",
      tasks: [{ id: "T1" }],
    });

    expect(results[0].status).toBe("completed");
    expect(mockInvocation.invoke).toHaveBeenCalledTimes(2);
    expect(orchestrator.throttle).toHaveBeenCalledWith("gemini", 1);
  });
});
