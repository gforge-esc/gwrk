import { describe, expect, it, vi, beforeEach } from "vitest";
import { selectBackend } from "./router.js";
import { quotaProbe } from "./quota.js";
import { PluginLoader } from "../plugins/loader.js";
import { builtInAgents } from "../plugins/builtins/agents/index.js";

vi.mock("../plugins/loader.js");
vi.mock("../plugins/builtins/agents/index.js", () => ({
  builtInAgents: {
    gemini: { name: "gemini", checkQuota: vi.fn().mockResolvedValue({ status: "available" }) },
    claude: { name: "claude", checkQuota: vi.fn().mockResolvedValue({ status: "available" }) },
    codex: { name: "codex", checkQuota: vi.fn().mockResolvedValue({ status: "available" }) },
  }
}));

describe("FR-014 / Phase 4: Routing & Intelligence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementation for resolvePlugin
    (PluginLoader.prototype.resolvePlugin as any).mockImplementation(async (name: string) => {
        if (name === "claude" || name === "gemini") {
            return { manifest: { type: "agent", name }, status: "active" };
        }
        throw new Error("Not found");
    });
  });

  describe("selectBackend() (FR-014 / FR-P4-001)", () => {
    it("US-L1-001: respects fallbackOrder from config (FR-P4-001)", async () => {
      // Mocking 'claude' as rate-limited/busy
      (builtInAgents.claude.checkQuota as any).mockResolvedValueOnce({ status: "rate_limited" });
      
      const config: any = {
        agents: {
          fallbackOrder: ["claude", "gemini"]
        }
      };
      const task = { type: "implement" };
      const backend = await selectBackend(task, config);
      expect(backend.name).toBe("gemini");
    });

    it("picks the preferredAgent from task if available", async () => {
      const task = { type: "skill", skillName: "narrative", preferredAgent: "claude" };
      const backend = await selectBackend(task);
      expect(backend.name).toBe("claude");
    });
    
    it("falls back to next in order if preferredAgent is rate-limited", async () => {
      (builtInAgents.claude.checkQuota as any).mockResolvedValue({ status: "rate_limited" });
      const task = { type: "skill", skillName: "narrative", preferredAgent: "claude" };
      const config: any = { agents: { fallbackOrder: ["claude", "gemini"] } };
      
      const backend = await selectBackend(task, config);
      expect(backend.name).toBe("gemini");
    });
  });

  describe("quotaProbe() (FR-P4-002)", () => {
    it("detects 429 rate-limit and returns status (FR-P4-002)", async () => {
      const mockBackend = { 
        name: "gemini", 
        checkQuota: vi.fn().mockResolvedValue({ status: "rate_limited", backoffS: 60 }) 
      };
      const status = await quotaProbe(mockBackend as any);
      expect(status.status).toBe("rate_limited");
      expect(status.backoffS).toBe(60);
    });

    it("returns available if checkQuota is not implemented", async () => {
      const mockBackend = { name: "simple" };
      const status = await quotaProbe(mockBackend as any);
      expect(status.status).toBe("available");
    });
  });
});
