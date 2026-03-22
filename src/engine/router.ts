import { PluginLoader } from "../plugins/loader.js";
import { builtInAgents } from "../plugins/builtins/agents/index.js";
import { quotaProbe } from "./quota.js";
import { getDb } from "../db/index.js";
import type { AgentBackend } from "../plugins/agent-backend.js";
import type { GwrkConfig } from "../utils/config.js";

export interface TaskInfo {
  type: string;
  skillName?: string;
  preferredAgent?: string;
}

/**
 * Optimal backend selection based on task, quota, and history.
 * FR-014 / Phase 4: Routing & Intelligence
 */
export async function selectBackend(
  task: TaskInfo,
  config?: GwrkConfig,
  projectRoot?: string,
): Promise<AgentBackend> {
  const loader = new PluginLoader({ projectDir: projectRoot });

  // 1. Priority: Task-specific preferred agent (from skill manifest or CLI arg)
  if (task.preferredAgent) {
    try {
      const backend = await getAdapterForPlugin(task.preferredAgent, loader);
      if (backend) {
        const quota = await quotaProbe(backend);
        if (quota.status === "available") return backend;
      }
    } catch (e) {
      // Fallback if preferred is not found or unavailable
    }
  }

  // 2. Priority: Configured fallback order
  const fallbacks = config?.agents?.fallbackOrder || ["claude", "gemini", "codex"];
  for (const name of fallbacks) {
    const backend = await getAdapterForPlugin(name, loader);
    if (backend) {
      const quota = await quotaProbe(backend);
      if (quota.status === "available") return backend;
    }
  }

  // 3. Last resort: Any available built-in
  for (const name in builtInAgents) {
    const backend = builtInAgents[name];
    const quota = await quotaProbe(backend);
    if (quota.status === "available") return backend;
  }

  throw new Error("No available agent backends found.");
}

/**
 * Helper to resolve a plugin name to an AgentBackend instance.
 */
async function getAdapterForPlugin(name: string, loader: PluginLoader): Promise<AgentBackend | undefined> {
  // Check built-ins first for performance
  if (builtInAgents[name]) return builtInAgents[name];

  try {
    const loaded = await loader.resolvePlugin(name);
    if (loaded.manifest.type === "agent") {
      // In a full implementation, we would dynamic import the adapter from loaded.path
      // For now, we only support built-ins as actual functional adapters.
      return builtInAgents[name];
    }
  } catch (e) {}

  return undefined;
}

/**
 * Log routing decision to history.
 */
export function logRoutingDecision(decision: {
  taskType: string;
  skillName?: string;
  backendName: string;
  status: string;
  errorType?: string;
  durationMs?: number;
  tokenUsage?: { input: number; output: number };
}): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO routing_decisions (
        task_type, skill_name, backend_name, status, error_type, 
        duration_ms, token_usage_input, token_usage_output
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      decision.taskType,
      decision.skillName || null,
      decision.backendName,
      decision.status,
      decision.errorType || null,
      decision.durationMs || null,
      decision.tokenUsage?.input || null,
      decision.tokenUsage?.output || null
    );
  } catch (e) {
    // Non-blocking
    console.error("Failed to log routing decision:", e);
  }
}
