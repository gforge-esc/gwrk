/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execCommand } from "../utils/exec.js";
import type { AgentBackendConfig } from "./agent-registry.js";
import { QuotaProber } from "./quota-prober.js";
import { TaskClassification } from "./task-classifier.js";

vi.mock("node:fs");
vi.mock("../utils/exec.js");

describe("QuotaProber", () => {
  let prober: QuotaProber;
  const projectRoot = "/tmp/gwrk";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    prober = new QuotaProber(projectRoot);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const mockBackend: AgentBackendConfig = {
    name: "codex",
    type: "local-cli",
    command: "codex exec",
    quotaProbe: {
      method: "interactive-scrape",
      command: "codex",
      sendKeys: "/status",
      parseRegex: "(\\d+)% left",
      cacheTTLMinutes: 5,
    },
    maxConcurrent: 1,
    models: [{ name: "gpt-4", tier: TaskClassification.THINKING }],
  };

  it("should return fresh quota reading on success", async () => {
    vi.mocked(execCommand).mockResolvedValue({
      exitCode: 0,
      stdout: "80% left",
      stderr: "",
    });

    const probePromise = prober.probeQuota(mockBackend, { codex: mockBackend });

    // Advance for 1000ms + 1500ms + buffer
    await vi.advanceTimersByTimeAsync(3000);

    const reading = await probePromise;

    expect(reading.percent).toBe(80);
    expect(reading.status).toBe("fresh");
  });

  it("should return optimistic reading on timeout (TR-005)", async () => {
    // Mock execCommand to hang
    vi.mocked(execCommand).mockImplementation(() => new Promise(() => {}));

    const probePromise = prober.probeQuota(mockBackend, { codex: mockBackend });

    // Advance timers past 5000ms
    await vi.advanceTimersByTimeAsync(6000);

    const reading = await probePromise;
    expect(reading.percent).toBe(100);
    expect(reading.status).toBe("timeout-assumed-available");
  });

  it("should return cached reading within TTL (TR-007)", async () => {
    vi.mocked(execCommand).mockResolvedValue({
      exitCode: 0,
      stdout: "80% left",
      stderr: "",
    });

    const probePromise1 = prober.probeQuota(mockBackend, {
      codex: mockBackend,
    });
    await vi.advanceTimersByTimeAsync(3000);
    const reading1 = await probePromise1;
    expect(reading1.status).toBe("fresh");

    const reading2 = await prober.probeQuota(mockBackend, {
      codex: mockBackend,
    });
    expect(reading2.status).toBe("cached");
    expect(reading2.percent).toBe(80);
  });

  it("should re-probe after TTL expires (TR-007)", async () => {
    vi.mocked(execCommand).mockResolvedValue({
      exitCode: 0,
      stdout: "80% left",
      stderr: "",
    });

    const probePromise1 = prober.probeQuota(mockBackend, {
      codex: mockBackend,
    });
    await vi.advanceTimersByTimeAsync(3000);
    await probePromise1;

    // Simulate passage of 6 minutes
    vi.advanceTimersByTime(6 * 60 * 1000);

    const probePromise2 = prober.probeQuota(mockBackend, {
      codex: mockBackend,
    });
    await vi.advanceTimersByTimeAsync(3000);

    const reading2 = await probePromise2;
    expect(reading2.status).toBe("fresh");
  });

  it("should handle shared-pool method", async () => {
    const geminiBackend: AgentBackendConfig = {
      ...mockBackend,
      name: "gemini",
      quotaProbe: {
        method: "shared-pool",
        sharedWith: "codex",
        cacheTTLMinutes: 0,
      },
    };

    vi.mocked(execCommand).mockResolvedValue({
      exitCode: 0,
      stdout: "75% left",
      stderr: "",
    });

    const readingPromise = prober.probeQuota(geminiBackend, {
      codex: mockBackend,
      gemini: geminiBackend,
    });
    await vi.advanceTimersByTimeAsync(3000);

    const reading = await readingPromise;
    expect(reading.percent).toBe(75);
    expect(reading.status).toBe("shared-pool");
  });

  it("should prevent infinite recursion in shared-pool", async () => {
    const backendA: AgentBackendConfig = {
      ...mockBackend,
      name: "backendA",
      quotaProbe: {
        method: "shared-pool",
        sharedWith: "backendB",
        cacheTTLMinutes: 0,
      },
    };
    const backendB: AgentBackendConfig = {
      ...mockBackend,
      name: "backendB",
      quotaProbe: {
        method: "shared-pool",
        sharedWith: "backendA",
        cacheTTLMinutes: 0,
      },
    };

    const reading = await prober.probeQuota(backendA, { backendA, backendB });
    expect(reading.status).toBe("shared-pool");
    expect(reading.percent).toBe(100); // Optimistic fallback
  });

  it("should track model cooldowns", () => {
    prober.markModelFailure("gemini", "pro", 1000);
    expect(prober.isModelInCooldown("gemini", "pro")).toBe(true);

    vi.useFakeTimers();
    vi.advanceTimersByTime(1500);
    expect(prober.isModelInCooldown("gemini", "pro")).toBe(false);
  });
});
