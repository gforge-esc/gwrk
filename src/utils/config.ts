import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";

const AgentBackendTypeSchema = z.enum(["gemini", "claude", "codex", "codex-cloud"]);
export type AgentBackendType = z.infer<typeof AgentBackendTypeSchema>;

export const SlackConfigSchema = z.object({
  botToken: z.string().startsWith("xoxb-"),
  appToken: z.string().startsWith("xapp-"),
});

export type SlackConfig = z.infer<typeof SlackConfigSchema>;

export const GwrkConfigSchema = z.object({
  project: z.object({
    name: z.string().min(1),
    githubRepo: z.string().optional(),
    slack: z
      .object({
        channelId: z.string(),
        channelName: z.string(),
        opsChannelId: z.string().optional(),
        opsChannelName: z.string().optional(),
      })
      .optional(),
  }),
  agents: z.object({
    define: AgentBackendTypeSchema,
    implement: AgentBackendTypeSchema,
    fallbackOrder: z.array(AgentBackendTypeSchema).optional(),
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
    console.error("Configuration file .gwrkrc.json not found");
    process.exit(1);
  }

  let raw: any;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (error) {
    console.error("Configuration error: invalid JSON");
    process.exit(1);
  }

  // Inject environment variables into the raw object before parsing
  if (process.env.GITHUB_WEBHOOK_SECRET) {
    raw.server = raw.server ?? {};
    raw.server.githubWebhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  }

  const result = GwrkConfigSchema.safeParse(raw);
  if (!result.success) {
    console.error(`Configuration error: ${result.error.message}`);
    process.exit(1);
  }

  return result.data;
}
