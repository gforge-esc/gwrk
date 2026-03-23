import { describe, expect, it, vi, beforeEach } from "vitest";
// @ts-ignore - Module does not exist yet (RED)
import { selectBackend, quotaProbe } from "./router.js";
// @ts-ignore - Module does not exist yet (RED)
import { AgentBackend } from "../plugins/loader.js";

vi.mock("../plugins/loader.js");

describe("FR-014 / Phase 4: Routing & Intelligence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("selectBackend() (FR-014 / FR-P4-001)", () => {
    it("US-L1-001: respects fallbackOrder from config (FR-P4-001)", async () => {
      // Mocking config with fallbackOrder: ['claude', 'gemini']
      // Mocking 'claude' as busy or failed
      const task = { type: 'implement' };
      const backend = await selectBackend(task);
      expect(backend.name).toBe('gemini');
    });

    it("picks the preferredAgent from skill manifest if available", async () => {
      const task = { type: 'skill', skillName: 'narrative' };
      // Skill manifest says preferredAgent: 'claude'
      const backend = await selectBackend(task);
      expect(backend.name).toBe('claude');
    });
  });

  describe("quotaProbe() (FR-P4-002)", () => {
    it("detects 429 rate-limit and applies backoff (FR-P4-002)", async () => {
      // Mocking an agent backend that returns 429-like error or status
      const mockBackend = { name: 'gemini', checkQuota: vi.fn().mockResolvedValue({ status: 'rate-limited', backoffS: 60 }) };
      const status = await quotaProbe(mockBackend);
      expect(status.status).toBe('rate-limited');
      expect(status.backoffS).toBeGreaterThan(0);
    });

    it("marks backend as unavailable after repeated failures", async () => {
        // This would involve state tracking in the router
    });
  });
});
