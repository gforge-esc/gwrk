import type { AgentBackend, BackendQuota } from "../plugins/agent-backend.js";

/**
 * Probe an agent backend for current quota and availability.
 * FR-P4-002: Detects rate-limits and availability issues.
 */
export async function quotaProbe(backend: AgentBackend): Promise<BackendQuota> {
  if (backend.checkQuota) {
    try {
      return await backend.checkQuota();
    } catch (e) {
      return {
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      } as any;
    }
  }

  // Default to available if not implemented
  return {
    status: "available",
  };
}
