import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
const AgentBackendSchema = z.enum(["gemini", "claude", "codex", "codex-cloud"]);
export const GwrkConfigSchema = z.object({
  project: z.object({
    name: z.string().min(1),
  }),
  agents: z.object({
    define: AgentBackendSchema,
    implement: AgentBackendSchema,
  }),
});
export function loadConfig(projectRoot) {
  const configPath = path.join(projectRoot, ".gwrkrc.json");
  if (!fs.existsSync(configPath)) {
    console.error("Configuration file .gwrkrc.json not found");
    process.exit(1);
  }
  let raw;
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
