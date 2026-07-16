/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { DEFAULT_LOC_RATES } from "../engine/effort-defaults.js";
import { resolveRoleMultipliers } from "../engine/roles.js";
import { AgentBackendConfigSchema } from "../server/agent-registry.js";

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
  // Optional so a project-identity-only .gwrkrc.json (agents live in the
  // gitignored .gwrkrc.local.json layer) still validates. Inner defaults fill
  // in define/implement when the whole block is absent.
  agents: z
    .object({
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
    })
    .default({}),
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

/**
 * Deep-merge two plain objects. Overlay values win.
 * - Objects are recursively merged.
 * - Arrays and primitives in overlay replace base entirely.
 * - Undefined overlay values are skipped (base preserved).
 */
// biome-ignore lint/suspicious/noExplicitAny: JSON merge utility operates on arbitrary config shapes
export function deepMerge(base: Record<string, any>, overlay: Record<string, any>): Record<string, any> {
  const result = { ...base };
  for (const key of Object.keys(overlay)) {
    const baseVal = base[key];
    const overVal = overlay[key];
    if (
      overVal !== null &&
      typeof overVal === "object" &&
      !Array.isArray(overVal) &&
      baseVal !== null &&
      typeof baseVal === "object" &&
      !Array.isArray(baseVal)
    ) {
      result[key] = deepMerge(baseVal, overVal);
    } else {
      result[key] = overVal;
    }
  }
  return result;
}

/**
 * Attempts to read and parse a JSON file. Returns null if file doesn't exist
 * or contains invalid JSON (logged but non-fatal for overlay files).
 */
// biome-ignore lint/suspicious/noExplicitAny: JSON config parsing
function tryReadJson(filePath: string, label: string): Record<string, any> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (error) {
    console.error(`Warning: invalid JSON in ${label} at ${filePath}, skipping overlay`);
    return null;
  }
}

/**
 * Three-layer config resolution:
 *
 * 1. `.gwrkrc.json` (project root, tracked) — project identity: name, type,
 *    stack, layout, server defaults. Shared across team.
 *
 * 2. `.gwrkrc.local.json` (project root, gitignored) — personal per-project
 *    overrides: agents.define, agents.implement, agents.registry. Each dev
 *    picks their own agent without touching tracked files.
 *
 * 3. `~/.gwrk/config.json` (global home, never in any repo) — machine-wide
 *    secrets and preferences: Slack tokens, webhook URLs, API keys.
 *
 * Merge order: project → local → global (later layers win via deepMerge).
 */
export function loadConfig(projectRoot: string): GwrkConfig {
  const configPath = path.join(projectRoot, ".gwrkrc.json");

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Configuration file .gwrkrc.json not found at ${configPath}. Run 'gwrk init' to initialize this project.`,
    );
  }

  // Layer 1: Project config (required)
  // biome-ignore lint/suspicious/noExplicitAny: Parsed json configuration
  let raw: Record<string, any>;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (error) {
    throw new Error("Configuration error: invalid JSON in .gwrkrc.json");
  }

  // Layer 2: Personal per-project overrides (optional)
  const localPath = path.join(projectRoot, ".gwrkrc.local.json");
  const localOverrides = tryReadJson(localPath, ".gwrkrc.local.json");
  if (localOverrides) {
    raw = deepMerge(raw, localOverrides);
  }

  // Layer 3: Machine-wide global config (optional)
  // GWRK_HOME overrides ~/.gwrk for testing and non-standard installations
  const gwrkHome = process.env.GWRK_HOME || path.join(os.homedir(), ".gwrk");
  const globalPath = path.join(gwrkHome, "config.json");
  const globalOverrides = tryReadJson(globalPath, "~/.gwrk/config.json");
  if (globalOverrides) {
    raw = deepMerge(raw, globalOverrides);
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
