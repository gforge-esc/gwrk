import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { AgentBackendConfigSchema } from "../server/agent-registry.js";

const AgentBackendSchema = z.string();
export type AgentBackend = string;

export const SlackConfigSchema = z.object({
  botToken: z.string().startsWith("xoxb-"),
  appToken: z.string().startsWith("xapp-"),
});

export type SlackConfig = z.infer<typeof SlackConfigSchema>;

export const GwrkConfigSchema = z.object({
  project: z.object({
    name: z.string().min(1),
    githubRepo: z.string().optional(),
    type: z.string().optional(),
    stack: z
      .object({
        language: z.string().optional(),
        framework: z.string().optional(),
        buildSystem: z.string().optional(),
      })
      .optional(),
    layout: z.string().optional(),
    architecture: z.string().optional(),
    conventions: z.string().optional(),
    slack: z
      .object({
        channelId: z.string(),
        channelName: z.string().optional(),
        webhookUrl: z.string().url().optional(),
        opsChannelId: z.string().optional(),
        opsChannelName: z.string().optional(),
      })
      .optional(),
  }),
  agents: z.object({
    define: AgentBackendSchema.default("gemini"),
    implement: AgentBackendSchema.default("gemini"),
    throttleMs: z.number().int().min(0).optional(),
    fallbackOrder: z.array(z.string()).optional(),
    registry: z.record(z.string(), AgentBackendConfigSchema).optional(),
    gemini: z
      .object({
        model: z.string().optional(),
        failbackModels: z.array(z.string()).optional(),
      })
      .optional(),
  }),
  server: z
    .object({
      port: z.number().int().min(0).max(65535),
      host: z.string().min(1),
      githubWebhookSecret: z.string().optional(),
      heartbeatIntervalMs: z.number().int().min(100).default(30000),
      networkCheckIntervalMs: z.number().int().min(100).default(60000),
      slack: z
        .object({
          presencePollIntervalMs: z.number().int().min(1000).default(60000),
        })
        .optional(),
    })
    .default({
      port: 18790,
      host: "localhost",
      heartbeatIntervalMs: 30000,
      networkCheckIntervalMs: 60000,
    }),
  parallelism: z
    .object({
      local: z
        .object({
          maxCpu: z.number().int().min(1).max(100).default(80),
          maxMem: z.number().int().min(1).max(100).default(80),
          minDiskGb: z.number().int().min(1).default(10),
          maxClones: z.number().int().min(1).default(4),
        })
        .default({
          maxCpu: 80,
          maxMem: 80,
          minDiskGb: 10,
          maxClones: 4,
        }),
      cloud: z
        .object({
          maxConcurrent: z.number().int().min(1).default(10),
        })
        .default({
          maxConcurrent: 10,
        }),
    })
    .default({
      local: {
        maxCpu: 80,
        maxMem: 80,
        minDiskGb: 10,
        maxClones: 4,
      },
      cloud: {
        maxConcurrent: 10,
      },
    }),
  plugins: z
    .object({
      globalDir: z.string().optional(),
    })
    .optional(),
  review: z
    .object({
      strategy: z.enum(["cli", "webapp"]).optional(),
    })
    .optional(),
  pulse: z
    .object({
      repos: z.array(z.string().min(1)),
    })
    .optional(),
});

export type GwrkConfig = z.infer<typeof GwrkConfigSchema>;

export function loadConfig(projectRoot: string): GwrkConfig {
  const configPath = path.join(projectRoot, ".gwrkrc.json");

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Configuration file .gwrkrc.json not found at ${configPath}`,
    );
  }

  // biome-ignore lint/suspicious/noExplicitAny: Parsed json configuration
  let raw: Record<string, any>;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (error) {
    throw new Error("Configuration error: invalid JSON in .gwrkrc.json");
  }

  // Inject environment variables into the raw object before parsing
  if (process.env.GITHUB_WEBHOOK_SECRET) {
    raw.server = raw.server ?? {};
    raw.server.githubWebhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  }

  // Inject names into agents.registry entries if they exist
  if (raw.agents?.registry) {
    for (const [name, config] of Object.entries(raw.agents.registry)) {
      if (typeof config === "object" && config !== null) {
        (config as any).name = (config as any).name ?? name;
      }
    }
  }

  const result = GwrkConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Configuration error in .gwrkrc.json: ${result.error.message}`,
    );
  }

  return result.data;
}
