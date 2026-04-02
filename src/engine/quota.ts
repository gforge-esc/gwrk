import type { AgentBackend } from "../plugins/agent-backend.js";

export interface QuotaStatus {
  status: "available" | "rate-limited" | "exhausted" | "unavailable";
  backoffS?: number;
  remainingRequests?: number;
  resetAt?: Date;
}

/**
 * Probes the current quota status of a backend.
 * Uses the backend's native checkQuota if available, otherwise infers from recent errors.
 */
export async function quotaProbe(backend: AgentBackend): Promise<QuotaStatus> {
  // If the backend has a native checkQuota method, use it.
  if (typeof (backend as any).checkQuota === "function") {
    return await (backend as any).checkQuota();
  }

  // Fallback to availability check
  const available = await backend.isAvailable();
  if (!available) {
    return { status: "unavailable" };
  }

  // Generic available status if no other info
  return { status: "available" };
}
