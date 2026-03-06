import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const AgentBackendSchema = z.enum(["gemini", "claude", "codex", "codex-cloud"]);
export type AgentBackend = z.infer<typeof AgentBackendSchema>;

export const GwrkConfigSchema = z.object({
  project: z.object({
    name: z.string().min(1),
  }),
  agents: z.object({
    define: AgentBackendSchema,
    implement: AgentBackendSchema,
  }),
  server: z.object({
    port: z.number().int().min(1024).max(65535),
    host: z.string().min(1),
  }),
  parallelism: z.object({
    local: z.object({
      maxCpu: z.number().int().min(1).max(100),
      maxMem: z.number().int().min(1).max(100),
      minDiskGb: z.number().int().min(1),
      maxClones: z.number().int().min(1),
    }),
    cloud: z.object({
      maxConcurrent: z.number().int().min(1),
    }),
  }),
  pulse: z.object({
    repos: z.array(z.string().min(1)),
  }).optional(),
});

export type GwrkConfig = z.infer<typeof GwrkConfigSchema>;

export function loadConfig(projectRoot: string): GwrkConfig {
  const configPath = path.join(projectRoot, ".gwrkrc.json");

  if (!fs.existsSync(configPath)) {
    console.error("Configuration file .gwrkrc.json not found");
    process.exit(1);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (error) {
    console.error("Configuration error: invalid JSON");
    process.exit(1);
  }

  const result = GwrkConfigSchema.safeParse(raw);
  if (!result.success) {
    console.error(`Configuration error: ${result.error.message}`);
    process.exit(1);
  }

  return result.data;
}
