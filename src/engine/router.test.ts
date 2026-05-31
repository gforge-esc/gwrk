import { describe, expect, it, vi, beforeEach } from "vitest";
import { selectBackend } from "./router.js";
import * as quotaModule from "./quota.js";
import { AgentBackendRegistry } from "../plugins/agent-registry.js";
import * as configModule from "../utils/config.js";
import { getRoutingHistory } from "../db/plugins.js";

vi.mock("../plugins/agent-registry.js");
vi.mock("../utils/config.js");
vi.mock("../db/plugins.js");
// Removed vi.mock("./quota.js") to allow testing actual quotaProbe

describe("FR-014 / Phase 4: Routing & Intelligence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.mocked(getRoutingHistory).mockReturnValue([]);
  });

  describe("selectBackend() (FR-014 / FR-P4-001)", () => {
    it("respects fallbackOrder from config (FR-P4-001)", async () => {
      vi.spyOn(configModule, 'loadConfig').mockReturnValue({
        agents: {
          fallbackOrder: ['claude', 'gemini']
        }
      } as any);

      const mockClaude = { name: 'claude', isAvailable: vi.fn().mockResolvedValue(true) };
      const mockGemini = { name: 'gemini', isAvailable: vi.fn().mockResolvedValue(true) };

      const registry = new AgentBackendRegistry();
      vi.spyOn(registry, 'getAgentBackend').mockImplementation(async (name) => {
        if (name === 'claude') return mockClaude as any;
        if (name === 'gemini') return mockGemini as any;
        throw new Error('Not found');
      });

      // Mock quotaProbe for this test
      vi.spyOn(quotaModule, 'quotaProbe').mockImplementation(async (backend) => {
        if (backend.name === 'claude') return { status: 'rate-limited' };
        return { status: 'available' };
      });

      const task = { type: 'implement' };
      const backend = await selectBackend(task, process.cwd(), registry);
      expect(backend.name).toBe('gemini');
    });

    it("picks the preferredAgent for skill if available", async () => {
        vi.spyOn(configModule, 'loadConfig').mockReturnValue({
            agents: {
              fallbackOrder: ['gemini']
            }
          } as any);

          const mockClaude = { name: 'claude', isAvailable: vi.fn().mockResolvedValue(true) };
          const mockGemini = { name: 'gemini', isAvailable: vi.fn().mockResolvedValue(true) };
    
          const registry = new AgentBackendRegistry();
          vi.spyOn(registry, 'getAgentBackend').mockImplementation(async (name) => {
            if (name === 'claude') return mockClaude as any;
            if (name === 'gemini') return mockGemini as any;
            throw new Error('Not found');
          });

          vi.spyOn(quotaModule, 'quotaProbe').mockResolvedValue({ status: 'available' });

          const task = { type: 'skill', skillName: 'narrative' };
          const backend = await selectBackend(task, process.cwd(), registry);
          expect(backend.name).toBe('claude');
    });

    it("uses historical learning to pick the best backend", async () => {
        vi.spyOn(configModule, 'loadConfig').mockReturnValue({
            agents: {
              fallbackOrder: ['gemini']
            }
          } as any);

          const mockClaude = { name: 'claude', isAvailable: vi.fn().mockResolvedValue(true) };
          const mockGemini = { name: 'gemini', isAvailable: vi.fn().mockResolvedValue(true) };
    
          const registry = new AgentBackendRegistry();
          vi.spyOn(registry, 'getAgentBackend').mockImplementation(async (name) => {
            if (name === 'claude') return mockClaude as any;
            if (name === 'gemini') return mockGemini as any;
            throw new Error('Not found');
          });

          vi.spyOn(quotaModule, 'quotaProbe').mockResolvedValue({ status: 'available' });

          // Mock history where claude was very successful for this task type
          vi.mocked(getRoutingHistory).mockReturnValue([
              { selected_backend: 'claude', outcome: 'success', task_type: 'test-task' },
              { selected_backend: 'claude', outcome: 'success', task_type: 'test-task' },
              { selected_backend: 'claude', outcome: 'success', task_type: 'test-task' },
              { selected_backend: 'claude', outcome: 'success', task_type: 'test-task' },
              { selected_backend: 'claude', outcome: 'success', task_type: 'test-task' },
              { selected_backend: 'claude', outcome: 'success', task_type: 'test-task' },
          ]);

          const task = { type: 'test-task' };
          const backend = await selectBackend(task, process.cwd(), registry);
          expect(backend.name).toBe('claude');
    });

    it("uses task-specific mapping from config if available", async () => {
        vi.spyOn(configModule, 'loadConfig').mockReturnValue({
            agents: {
              'custom-task': 'gemini',
              fallbackOrder: ['claude']
            }
          } as any);

          const mockClaude = { name: 'claude', isAvailable: vi.fn().mockResolvedValue(true) };
          const mockGemini = { name: 'gemini', isAvailable: vi.fn().mockResolvedValue(true) };
    
          const registry = new AgentBackendRegistry();
          vi.spyOn(registry, 'getAgentBackend').mockImplementation(async (name) => {
            if (name === 'claude') return mockClaude as any;
            if (name === 'gemini') return mockGemini as any;
            throw new Error('Not found');
          });

          vi.spyOn(quotaModule, 'quotaProbe').mockResolvedValue({ status: 'available' });

          const task = { type: 'custom-task' };
          const backend = await selectBackend(task, process.cwd(), registry);
          expect(backend.name).toBe('gemini');
    });
  });

  describe("quotaProbe() (FR-P4-002)", () => {
    it("detects 429 rate-limit and applies backoff (FR-P4-002)", async () => {
      const mockBackend = { 
          name: 'gemini', 
          checkQuota: vi.fn().mockResolvedValue({ status: 'rate-limited', backoffS: 60 }) 
      };
      
      const status = await quotaModule.quotaProbe(mockBackend as any);
      expect(status.status).toBe('rate-limited');
      expect(status.backoffS).toBeGreaterThan(0);
    });
  });
});
