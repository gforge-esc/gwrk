/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { getRoutingHistory } from "../db/plugins.js";
import { resolveProjectId } from "../utils/project-id.js";
import type { AgentBackend } from "../plugins/agent-backend.js";
import { AgentBackendRegistry } from "../plugins/agent-registry.js";
import { loadConfig } from "../utils/config.js";
import { quotaProbe } from "./quota.js";

interface RoutingTask {
  type: string;
  skillName?: string;
  feature?: string;
  phase?: string;
  preferredAgent?: string;
}

/**
 * Selects the optimal backend for a given task.
 * Selection Order:
 * 1. preferredAgent from Skill manifest (if type === 'skill')
 * 2. Historical Success (learning): pick backend with best recent record for this task type
 * 3. Task-specific mapping from .gwrkrc.json (e.g. agents.define)
 * 4. Task-type default (e.g. 'implement' defaults to 'agy')
 * 5. fallbackOrder from .gwrkrc.json
 * 6. First available built-in
 */
export async function selectBackend(
  task: RoutingTask,
  projectRoot: string = process.cwd(),
  registry: AgentBackendRegistry = new AgentBackendRegistry(),
): Promise<AgentBackend> {
  const config = loadConfig(projectRoot);

  // 1. Check skill-specific preference (FR-006)
  if (task.preferredAgent) {
    try {
      const backend = await registry.getAgentBackend(task.preferredAgent);
      const status = await quotaProbe(backend);
      if (status.status === "available") return backend;
    } catch (e) {
      // Fall through to historical learning if preferred agent is unavailable
    }
  }

  if (task.type === "skill" && task.skillName) {
    // Legacy hardcoded preferences for specific skills
    if (task.skillName === "narrative" || task.skillName === "signal-cut") {
      try {
        const backend = await registry.getAgentBackend("claude");
        const status = await quotaProbe(backend);
        if (status.status === "available") return backend;
      } catch (e) {
        // Fall through
      }
    }
  }

  // 2. Historical Learning
  try {
    const projectId = resolveProjectId(projectRoot);
    const history = getRoutingHistory(task.type, projectId, 50);
    if (history.length >= 5) {
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
        if (item.rate > 0.7) {
          // 70% confidence threshold for learning
          try {
            const backend = await registry.getAgentBackend(item.name);
            const status = await quotaProbe(backend);
            if (status.status === "available") return backend;
          } catch (e) {
            // Backend might have been removed or renamed
          }
        }
      }
    }
  } catch (err) {
    // History check failed (maybe DB not initialized), continue to other methods
  }

  // 3. Task-specific mapping from config (e.g. agents.define: "agy")
  const agentsConfig = config.agents as any;
  let taskBackendName = agentsConfig?.[task.type];

  // 4. Task-type default (Autonomous implementation defaults to agy)
  if (!taskBackendName && task.type === "implement") {
    taskBackendName = "agy";
  }

  if (typeof taskBackendName === "string") {
    try {
      const backend = await registry.getAgentBackend(taskBackendName);
      const status = await quotaProbe(backend);
      if (status.status === "available") return backend;
    } catch (e) {}
  }

  // 5. Fallback order from config
  const fallbackOrder = agentsConfig?.fallbackOrder || [
    "agy",
    "claude",
    "codex",
  ];
  for (const name of fallbackOrder) {
    try {
      const backend = await registry.getAgentBackend(name);
      const status = await quotaProbe(backend);
      if (status.status === "available") return backend;
    } catch (e) {}
  }

  // 5. Last resort: any registered backend that is available
  const allBackends = await registry.getBackends();
  for (const backend of Object.values(allBackends)) {
    try {
      const status = await quotaProbe(backend);
      if (status.status === "available") return backend;
    } catch (e) {}
  }

  throw new Error(
    `No available agent backends found for task type: ${task.type}`,
  );
}
