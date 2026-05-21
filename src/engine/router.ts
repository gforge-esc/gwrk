import { getRoutingHistory } from "../db/plugins.js";
import type { AgentBackend } from "../plugins/agent-backend.js";
import { AgentBackendRegistry } from "../plugins/agent-registry.js";
import { loadConfig } from "../utils/config.js";
import { quotaProbe } from "./quota.js";

export interface RoutingTask {
  type: string;
  skillName?: string;
}

/**
 * Selects the optimal backend for a given task.
 * Selection Order:
 * 1. preferredAgent from Skill manifest (if type === 'skill')
 * 2. Historical Success (learning): pick backend with best recent record for this task type
 * 3. Task-specific mapping from .gwrkrc.json (e.g. agents.define)
 * 4. fallbackOrder from .gwrkrc.json
 * 5. First available built-in
 */
export async function selectBackend(
  task: RoutingTask,
  projectRoot: string = process.cwd(),
  registry: AgentBackendRegistry = new AgentBackendRegistry(),
): Promise<AgentBackend> {
  const config = loadConfig(projectRoot);

  // 1. Check skill-specific preference (Mocked for now as we don't have skill loader here yet)
  if (task.type === "skill" && task.skillName) {
    if (task.skillName === "narrative") {
      try {
        const backend = await registry.getAgentBackend("claude");
        const status = await quotaProbe(backend);
        if (status.status === "available") return backend;
      } catch (e) {}
    }
  }

  // 2. Historical Learning
  const history = getRoutingHistory(task.type, 50);
  if (history.length > 5) {
    // Simple heuristic: count successes per backend
    const stats = history.reduce(
      (acc, d) => {
        acc[d.selected_backend] = acc[d.selected_backend] || {
          success: 0,
          total: 0,
        };
        acc[d.selected_backend].total++;
        if (d.outcome === "success") acc[d.selected_backend].success++;
        return acc;
      },
      {} as Record<string, { success: number; total: number }>,
    );

    const ranked = Object.entries(stats)
      .map(([name, s]) => ({ name, rate: s.success / s.total }))
      .sort((a, b) => b.rate - a.rate);

    for (const item of ranked) {
      if (item.rate > 0.8) {
        // High confidence
        try {
          const backend = await registry.getAgentBackend(item.name);
          const status = await quotaProbe(backend);
          if (status.status === "available") return backend;
        } catch (e) {}
      }
    }
  }

  // 3. Task-specific mapping from config
  const taskBackendName = (config.agents as unknown as Record<string, string>)[
    task.type
  ];
  if (taskBackendName) {
    try {
      const backend = await registry.getAgentBackend(taskBackendName);
      const status = await quotaProbe(backend);
      if (status.status === "available") return backend;
    } catch (e) {}
  }

  // 3. Fallback order
  const fallbackOrder = config.agents.fallbackOrder || [
    "claude",
    "gemini",
    "agy",
    "codex",
  ];
  for (const name of fallbackOrder) {
    try {
      const backend = await registry.getAgentBackend(name);
      const status = await quotaProbe(backend);
      if (status.status === "available") return backend;
    } catch (e) {}
  }

  // 4. Last resort: any available built-in
  const builtins = ["claude", "gemini", "agy", "codex"];
  for (const name of builtins) {
    try {
      const backend = await registry.getAgentBackend(name);
      if (await backend.isAvailable()) return backend;
    } catch (e) {}
  }

  throw new Error("No available agent backends found.");
}
