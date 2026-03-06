import { describe, it, expect, vi, beforeEach } from "vitest";
import { DispatchQueue } from "./dispatch.js";
import type { GwrkConfig } from "../utils/config.js";

// Mock all dependencies
const mockSandbox = {
  createSandbox: vi.fn().mockResolvedValue({ containerId: "abc123", status: "running" }),
  destroySandbox: vi.fn().mockResolvedValue(undefined),
};

const mockGitManager = {
  createPhaseBranch: vi.fn().mockResolvedValue("phase/001-cli-core-phase-01"),
  mergePhaseBack: vi.fn().mockResolvedValue(undefined),
};

const mockContext = {
  compileContext: vi.fn().mockResolvedValue("# Context"),
  writeContextToSandbox: vi.fn().mockResolvedValue(undefined),
};

const mockMonitor = {
  isThrottled: vi.fn().mockReturnValue(false),
};

const mockPersist = {
  persistDispatch: vi.fn(),
};

const TEST_CONFIG = {
  parallelism: {
    local: { maxClones: 2, maxCpu: 80, maxMem: 70, minDiskGb: 5 },
    cloud: { maxConcurrent: 5 },
  },
  agents: {
    define: "gemini",
    implement: "claude",
    fallbackOrder: ["gemini", "claude", "codex"],
  },
} as unknown as GwrkConfig;

// FR-008: Dispatch queue
describe("FR-008: DispatchQueue", () => {
  let queue: DispatchQueue;

  beforeEach(() => {
    vi.clearAllMocks();
    queue = new DispatchQueue({
      config: TEST_CONFIG,
      sandbox: mockSandbox,
      gitManager: mockGitManager,
      context: mockContext,
      monitor: mockMonitor,
      persist: mockPersist,
    });
  });

  // US-005 #1: enqueue creates a queued dispatch record
  describe("enqueue()", () => {
    it("US-005 #1: creates dispatch record with status 'queued'", () => {
      const record = queue.enqueue({
        featureId: "001-cli-core",
        phaseId: "phase-01",
        backend: "gemini",
      });
      expect(record.status).toBe("queued");
      expect(record.featureId).toBe("001-cli-core");
      expect(record.phaseId).toBe("phase-01");
      expect(record.id).toBeDefined();
    });

    it("US-005 #2: persists dispatch record to JSONL", () => {
      queue.enqueue({
        featureId: "001-cli-core",
        phaseId: "phase-01",
        backend: "gemini",
      });
      expect(mockPersist.persistDispatch).toHaveBeenCalled();
    });

    // Error: invalid backend
    it("ERROR #1: throws on unknown agent backend", () => {
      expect(() =>
        queue.enqueue({
          featureId: "001-cli-core",
          phaseId: "phase-01",
          backend: "nonexistent" as any,
        })
      ).toThrow(/Unknown agent backend/);
    });
  });

  // TC-001: FIFO ordering
  describe("FIFO ordering", () => {
    it("TC-001: dispatches are processed in FIFO order", () => {
      queue.enqueue({ featureId: "f1", phaseId: "p1", backend: "gemini" });
      queue.enqueue({ featureId: "f2", phaseId: "p2", backend: "claude" });
      const state = queue.getQueue();
      // First enqueued should be first in queue or active
      const firstId = state.active[0]?.featureId ?? state.queued[0]?.featureId;
      expect(firstId).toBe("f1");
    });
  });

  // FR-008: maxClones throttling
  describe("maxClones throttling", () => {
    it("US-005 #3: does not exceed maxClones active dispatches", () => {
      // maxClones = 2 in config
      queue.enqueue({ featureId: "f1", phaseId: "p1", backend: "gemini" });
      queue.enqueue({ featureId: "f2", phaseId: "p2", backend: "gemini" });
      queue.enqueue({ featureId: "f3", phaseId: "p3", backend: "gemini" });
      const state = queue.getQueue();
      expect(state.active.length).toBeLessThanOrEqual(2);
      expect(state.queued.length).toBeGreaterThanOrEqual(1);
    });
  });

  // FR-009: Retry + escalation
  describe("handleCompletion() — retry logic", () => {
    it("FR-009 #1: retries up to 3 times on same backend", async () => {
      const record = queue.enqueue({
        featureId: "001-cli-core",
        phaseId: "phase-01",
        backend: "gemini",
      });

      // Simulate 3 failures
      await queue.handleCompletion(record.id, 1, "error 1");
      await queue.handleCompletion(record.id, 1, "error 2");
      await queue.handleCompletion(record.id, 1, "error 3");

      const dispatch = queue.getDispatch("001-cli-core", "phase-01");
      expect(dispatch).toBeDefined();
      expect(dispatch!.attempts.length).toBe(3);
    });

    it("FR-009 #2: escalates to next backend after 3 failures", async () => {
      const record = queue.enqueue({
        featureId: "001-cli-core",
        phaseId: "phase-01",
        backend: "gemini",
      });

      // 3 failures on gemini → should escalate to claude
      await queue.handleCompletion(record.id, 1, "fail 1");
      await queue.handleCompletion(record.id, 1, "fail 2");
      await queue.handleCompletion(record.id, 1, "fail 3");

      const dispatch = queue.getDispatch("001-cli-core", "phase-01");
      // After 3 fails, 4th attempt should use different backend
      const lastAttempt =
        dispatch!.attempts[dispatch!.attempts.length - 1];
      expect(lastAttempt.backend).not.toBe("gemini");
    });

    it("FR-009 #3: marks as failed when all backends exhausted", async () => {
      const record = queue.enqueue({
        featureId: "001-cli-core",
        phaseId: "phase-01",
        backend: "gemini",
      });

      // Fail through all backends (3 each × 3 backends = 9 attempts)
      for (let i = 0; i < 9; i++) {
        await queue.handleCompletion(record.id, 1, `fail ${i}`);
      }

      const dispatch = queue.getDispatch("001-cli-core", "phase-01");
      expect(dispatch!.status).toBe("failed");
    });

    it("FR-009 #4: records attempt with timestamp, exitCode, stderr", async () => {
      const record = queue.enqueue({
        featureId: "001-cli-core",
        phaseId: "phase-01",
        backend: "gemini",
      });

      await queue.handleCompletion(record.id, 42, "some error");
      const dispatch = queue.getDispatch("001-cli-core", "phase-01");
      const attempt = dispatch!.attempts[0];
      expect(attempt.exitCode).toBe(42);
      expect(attempt.stderr).toBe("some error");
      expect(attempt.startedAt).toBeDefined();
    });
  });

  // Success path
  describe("handleCompletion() — success", () => {
    it("FR-008 #1: marks dispatch as completed on exit code 0", async () => {
      const record = queue.enqueue({
        featureId: "001-cli-core",
        phaseId: "phase-01",
        backend: "gemini",
      });
      await queue.handleCompletion(record.id, 0, "");
      const dispatch = queue.getDispatch("001-cli-core", "phase-01");
      expect(dispatch!.status).toBe("completed");
    });
  });

  // getQueue() shape
  describe("getQueue()", () => {
    it("US-005 #4: returns active, queued, and throttled fields", () => {
      const state = queue.getQueue();
      expect(state).toHaveProperty("active");
      expect(state).toHaveProperty("queued");
      expect(state).toHaveProperty("throttled");
      expect(Array.isArray(state.active)).toBe(true);
      expect(Array.isArray(state.queued)).toBe(true);
      expect(typeof state.throttled).toBe("boolean");
    });
  });

  // getDispatch()
  describe("getDispatch()", () => {
    it("US-004 #1: returns null for non-existent dispatch", () => {
      const result = queue.getDispatch("nonexistent", "phase-01");
      expect(result).toBeNull();
    });
  });

  // Monitor throttle integration
  describe("monitor throttle", () => {
    it("US-010 #1: does not process queue when throttled", () => {
      mockMonitor.isThrottled.mockReturnValue(true);
      queue.enqueue({ featureId: "f1", phaseId: "p1", backend: "gemini" });
      const state = queue.getQueue();
      expect(state.throttled).toBe(true);
    });
  });
});
