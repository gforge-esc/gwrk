/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { TaskClassification, TaskType } from "./types.js";

export function deepMerge(
  // biome-ignore lint/suspicious/noExplicitAny: Deep merge utility
  target: Record<string, any>,
  // biome-ignore lint/suspicious/noExplicitAny: Deep merge utility
  source: Record<string, any>,
  // biome-ignore lint/suspicious/noExplicitAny: Deep merge utility
): Record<string, any> {
  const output = { ...target };
  for (const key of Object.keys(source)) {
    const val = source[key];
    if (
      val &&
      typeof val === "object" &&
      !Array.isArray(val) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      output[key] = deepMerge(target[key], val);
    } else if (val !== undefined) {
      output[key] = val;
    }
  }
  return output;
}

export const ModelEntrySchema = z.object({
  name: z.string(),
  tier: z.nativeEnum(TaskClassification),
  modelFlag: z.string().optional(),
  effort: z.string().optional(),
  lastVerified: z.string().optional(),
});
export type ModelEntry = z.infer<typeof ModelEntrySchema>;

export const ProviderDocsSchema = z.object({
  models: z.string().url().optional(),
  routing: z.string().url().optional(),
  configuration: z.string().url().optional(),
});
export type ProviderDocs = z.infer<typeof ProviderDocsSchema>;

export const QuotaProbeSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("interactive-scrape"),
    command: z.string(),
    sendKeys: z.string(),
    parseRegex: z.string(),
    invertPercent: z.boolean().optional(),
    cacheTTLMinutes: z.number().int().min(0),
  }),
  z.object({
    method: z.literal("shared-pool"),
    sharedWith: z.string(),
    cacheTTLMinutes: z.number().int().min(0),
  }),
  z.object({
    method: z.literal("optimistic"),
    cacheTTLMinutes: z.number().int().min(0),
  }),
]);
export type QuotaProbe = z.infer<typeof QuotaProbeSchema>;

export const AgentBackendConfigSchema = z.object({
  name: z.string(),
  type: z.enum(["local-cli", "cloud"]),
  command: z.string(),
  docs: ProviderDocsSchema.optional(),
  discoveryMethod: z.enum(["manual", "cli-scrape"]).optional(),
  quotaProbe: QuotaProbeSchema,
  maxConcurrent: z.number().int().min(1),
  models: z.array(ModelEntrySchema),
  reviewModel: z.string().optional(),
  fallback: z.string().optional(),
});
export type AgentBackendConfig = z.infer<typeof AgentBackendConfigSchema>;

export const AgentRegistrySchema = z.object({
  backends: z.record(z.string(), AgentBackendConfigSchema),
  fallbackOrder: z.array(z.string()),
});
export type AgentRegistry = z.infer<typeof AgentRegistrySchema>;

export interface ModelCooldownChecker {
  isModelInCooldown(backendName: string, modelName: string): boolean;
}

export class ModelSelector {
  selectModel(
    backend: AgentBackendConfig,
    classification: TaskClassification,
    taskType: string | TaskType,
    prober: ModelCooldownChecker,
  ): { model: ModelEntry | null; modelFailoverUsed: boolean } {
    if (
      backend.reviewModel &&
      (taskType === TaskType.REVIEW || taskType === TaskType.TEST)
    ) {
      const reviewModelEntry = backend.models.find(
        (m) => m.modelFlag === backend.reviewModel,
      ) || {
        name: "review-model-override",
        tier: TaskClassification.THINKING,
        modelFlag: backend.reviewModel,
      };

      if (!prober.isModelInCooldown(backend.name, reviewModelEntry.name)) {
        return { model: reviewModelEntry, modelFailoverUsed: false };
      }
    }

    if (backend.models.length === 0) {
      const defaultModel: ModelEntry = {
        name: "default",
        tier: classification,
      };
      if (!prober.isModelInCooldown(backend.name, defaultModel.name)) {
        return { model: defaultModel, modelFailoverUsed: false };
      }
      return { model: null, modelFailoverUsed: false };
    }

    const preferredModels = backend.models.filter(
      (m) => m.tier === classification,
    );

    for (let i = 0; i < preferredModels.length; i++) {
      const model = preferredModels[i];
      if (!prober.isModelInCooldown(backend.name, model.name)) {
        return { model, modelFailoverUsed: i > 0 };
      }
    }

    for (const model of backend.models) {
      if (!prober.isModelInCooldown(backend.name, model.name)) {
        return { model, modelFailoverUsed: true };
      }
    }

    return { model: null, modelFailoverUsed: false };
  }

  renderCommand(template: string, model: ModelEntry): string {
    let command = template.replace(
      /\{\{model\}\}/g,
      model.modelFlag || model.name,
    );

    if (model.effort) {
      command += ` --effort ${model.effort}`;
    }

    return command;
  }
}

export function loadRegistry(
  projectRoot: string = process.cwd(),
): AgentRegistry {
  const configPath = path.join(projectRoot, ".gwrkrc.json");

  if (!fs.existsSync(configPath)) {
    console.error(
      `Missing required config: agents.registry (file .gwrkrc.json not found at ${configPath})`,
    );
    process.exit(1);
    return {} as AgentRegistry;
  }

  // biome-ignore lint/suspicious/noExplicitAny: Parsed json configuration
  let raw: Record<string, any>;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    console.error("Configuration error: invalid JSON in .gwrkrc.json");
    process.exit(1);
    return {} as AgentRegistry;
  }

  const localPath = path.join(projectRoot, ".gwrkrc.local.json");
  if (fs.existsSync(localPath)) {
    try {
      const local = JSON.parse(fs.readFileSync(localPath, "utf-8"));
      raw = deepMerge(raw, local);
    } catch {
      /* non-fatal */
    }
  }

  const globalPath = path.join(os.homedir(), ".gwrk", "config.json");
  if (fs.existsSync(globalPath)) {
    try {
      const global = JSON.parse(fs.readFileSync(globalPath, "utf-8"));
      raw = deepMerge(raw, global);
    } catch {
      /* non-fatal */
    }
  }

  if (
    !raw ||
    !raw.agents ||
    !raw.agents.registry ||
    !raw.agents.fallbackOrder
  ) {
    console.error(
      "Missing required config: agents.registry or agents.fallbackOrder",
    );
    process.exit(1);
    return {} as AgentRegistry;
  }

  // biome-ignore lint/suspicious/noExplicitAny: Dynamic config mapping
  const backends: Record<string, any> = {};
  for (const [name, config] of Object.entries(raw.agents.registry)) {
    // biome-ignore lint/suspicious/noExplicitAny: Dynamic config mapping
    backends[name] = { ...(config as any), name };
  }

  const result = AgentRegistrySchema.safeParse({
    backends,
    fallbackOrder: raw.agents.fallbackOrder,
  });
  if (!result.success) {
    console.error(`Invalid agent registry entry: ${result.error.message}`);
    process.exit(1);
  }

  return result.data;
}
