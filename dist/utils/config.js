import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
const AgentBackendSchema = z.enum(["gemini", "claude", "codex", "codex-cloud"]);
export const GwrkConfigSchema = z.object({
    project: z.object({
        name: z.string().min(1),
        githubRepo: z.string().optional(),
        slackChannel: z.string().optional(),
    }),
    agents: z.object({
        define: AgentBackendSchema,
        implement: AgentBackendSchema,
    }),
    server: z.object({
        port: z.number().int().min(1024).max(65535),
        host: z.string().min(1),
        heartbeatIntervalMs: z.number().int().min(100),
        networkCheckIntervalMs: z.number().int().min(100),
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
    pulse: z
        .object({
        repos: z.array(z.string().min(1)),
    })
        .optional(),
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
    }
    catch (error) {
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
