/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { deepMerge } from "../utils/config.js";
import { TaskClassification } from "./task-classifier.js";

export const ModelEntrySchema = z.object({
  name: z.string(),
  tier: z.nativeEnum(TaskClassification),
  modelFlag: z.string().optional(),
  effort: z.string().optional(),
  lastVerified: z.string().optional(), // ISO date
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

/**
 * Loads the agent registry using three-layer config resolution.
 * Project (.gwrkrc.json) → Personal (.gwrkrc.local.json) → Global (~/.gwrk/config.json).
 * Fail-fast on invalid or missing registry.
 */
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
  } catch (error) {
    console.error("Configuration error: invalid JSON in .gwrkrc.json");
    process.exit(1);
    return {} as AgentRegistry;
  }

  // Layer 2: Personal per-project overrides
  const localPath = path.join(projectRoot, ".gwrkrc.local.json");
  if (fs.existsSync(localPath)) {
    try {
      const local = JSON.parse(fs.readFileSync(localPath, "utf-8"));
      raw = deepMerge(raw, local);
    } catch { /* non-fatal */ }
  }

  // Layer 3: Machine-wide global config
  const globalPath = path.join(os.homedir(), ".gwrk", "config.json");
  if (fs.existsSync(globalPath)) {
    try {
      const global = JSON.parse(fs.readFileSync(globalPath, "utf-8"));
      raw = deepMerge(raw, global);
    } catch { /* non-fatal */ }
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

  // Inject 'name' from registry key into backend config as per contract
  const backends: Record<string, any> = {};
  for (const [name, config] of Object.entries(raw.agents.registry)) {
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
