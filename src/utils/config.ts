import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { AgentBackendConfigSchema } from "../server/agent-registry.js";
import { DEFAULT_LOC_RATES } from "../engine/effort-defaults.js";
import { resolveRoleMultipliers } from "../engine/roles.js";

const AgentBackendSchema = z.string();
export type AgentBackendId = string;

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
        /** Multiple languages detected in a polyglot monorepo */
        languages: z.array(z.string()).optional(),
        framework: z.string().optional(),
        buildSystem: z.string().optional(),
        testFramework: z.string().optional(),
        packageManager: z.string().optional(),
      })
      .optional(),
    layout: z
      .union([
        z.string(),
        z.object({
          sourceRoot: z.string().optional(),
          apps: z.string().optional(),
          packages: z.string().optional(),
          specs: z.string().optional(),
          docs: z.string().optional(),
        }),
      ])
      .optional(),
    architecture: z
      .union([
        z.string(),
        z.object({
          doc: z.string().optional(),
          decisions: z.string().optional(),
        }),
      ])
      .optional(),
    conventions: z
      .union([
        z.string(),
        z.object({
          branchPrefix: z.string().optional(),
          testPattern: z.string().optional(),
        }),
      ])
      .optional(),
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
  effort: z
    .object({
      profile: z.string().default("TS"),
      roles: z
        .record(
          z.string(),
          z.object({
            hoursPerSP: z.number().optional(),
          }),
        )
        .optional(),
      locRates: z.record(z.string(), z.number()).optional(),
    })
    .default({ profile: "TS" }),
  compression: z
    .object({
      sessionGapMinutes: z.number().default(30),
    })
    .default({ sessionGapMinutes: 30 }),
  extensions: z.record(z.string(), z.record(z.any())).optional(),
  workspaces: z
    .record(
      z.string(),
      z.object({
        type: z.string().optional(),
        stack: z
          .object({
            language: z.string().optional(),
            framework: z.string().optional(),
            buildSystem: z.string().optional(),
          })
          .optional(),
        layout: z.string().optional(),
      }),
    )
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
        const c = config as Record<string, unknown>;
        c.name = c.name ?? name;
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

/**
 * Resolves the effort configuration using a three-layer chain:
 * 1. Defaults (compiled-in)
 * 2. Profile-based rates
 * 3. Config overrides (from .gwrkrc.json)
 */
export function resolveEffortConfig(config: GwrkConfig): {
  profile: string;
  locRate: number;
  hoursPerSP: number;
} {
  const profile = config.effort.profile;

  // Layer 1 & 2: Defaults and Profile
  let locRate = DEFAULT_LOC_RATES[profile] ?? DEFAULT_LOC_RATES.TS ?? 50;

  // Layer 3: Config overrides (FR-019)
  const overrideRate = config.effort.locRates?.[profile];
  if (typeof overrideRate === "number") {
    locRate = overrideRate;
  }

  // Resolve hoursPerSP using existing role multiplier logic
  const roles = resolveRoleMultipliers(config);

  // Map common profiles to canonical role IDs
  let roleId = profile;
  if (profile === "Rust") roleId = "RE";

  const defaultRole = roles.find((r) => r.role === "TS") || {
    role: "TS",
    hoursPerSP: 4,
  };
  const role = roles.find((r) => r.role === roleId) || defaultRole;
  const hoursPerSP = role.hoursPerSP;

  return { profile, locRate, hoursPerSP };
}
