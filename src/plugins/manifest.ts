/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { z } from "zod";

/**
 * Shared regex for kebab-case validation
 */
const KEBAB_CASE_REGEX = /^[a-z0-9-]+$/;

/**
 * Shared regex for semver validation
 */
const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;

/**
 * Base schema for all plugins
 */
const PluginBaseSchema = z.object({
  type: z.enum([
    "agent",
    "skill",
    "workflow",
    "extension",
    "channel",
    "review",
  ]),
  name: z.string().min(1).regex(KEBAB_CASE_REGEX),
  version: z.string().regex(SEMVER_REGEX),
  description: z.string().min(1),
});

export type PluginBase = z.infer<typeof PluginBaseSchema>;

/**
 * Skill Interface (shared)
 */
const PluginFlagSchema = z.object({
  name: z.string(),
  values: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  default: z.string().optional(),
  description: z.string().optional(),
});

const PluginInterfaceSchema = z.object({
  input: z.literal("stdin"),
  output: z.literal("stdout"),
  flags: z.array(PluginFlagSchema).optional(),
});

/**
 * Skill Runtime
 */
const SkillRuntimeSchema = z.object({
  preferredAgent: z.string(),
  preferredModel: z.string(),
  fallbackAgent: z.string().optional(),
  maxInputTokens: z.number().optional(),
  expectedLatency: z.string().optional(),
});

/**
 * Skill Context
 */
const SkillContextSchema = z.object({
  required: z.array(z.string()).default(["input"]),
  optional: z.array(z.string()).default([]),
});

/**
 * Skill Pass (Compound)
 */
const SkillPassSchema = z.object({
  name: z.string(),
  skill: z.string(),
  summary: z.string(),
});

/**
 * Atomic Skill Manifest
 */
const AtomicSkillManifestSchema = PluginBaseSchema.extend({
  type: z.literal("skill"),
  tier: z.literal("atomic"),
  category: z.enum([
    "reasoning",
    "evaluative",
    "creative",
    "persona",
    "communication",
    "operational",
    "meta",
  ]),
  prompt: z.string(),
  interface: PluginInterfaceSchema,
  runtime: SkillRuntimeSchema,
  tags: z.array(z.string()).optional(),
});

/**
 * Compound Skill Manifest
 */
const CompoundSkillManifestSchema = PluginBaseSchema.extend({
  type: z.literal("skill"),
  tier: z.literal("compound"),
  composes: z.array(z.string()),
  passes: z.array(SkillPassSchema),
  interface: PluginInterfaceSchema,
  context: SkillContextSchema,
  outputContract: z.array(z.string()).optional(),
  runtime: SkillRuntimeSchema,
  tags: z.array(z.string()).optional(),
});

/**
 * Enforcement Skill Manifest
 */
const EnforcementSkillManifestSchema = PluginBaseSchema.extend({
  type: z.literal("skill"),
  tier: z.literal("enforcement"),
  scope: z.enum(["implementation", "review", "all"]).optional(),
  /** Language this enforcement skill applies to (e.g. "TypeScript", "Python"). Omit to load for all projects. */
  language: z.string().optional(),
  /** Framework this enforcement skill applies to (e.g. "React", "Express"). Omit to load for all projects. */
  framework: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

/**
 * Unified Skill Manifest (Discriminated Union on 'tier')
 */
export const SkillManifestSchema = z.discriminatedUnion("tier", [
  AtomicSkillManifestSchema,
  CompoundSkillManifestSchema,
  EnforcementSkillManifestSchema,
]);

/**
 * Agent Invocation (Layer 1)
 */
const InvocationSchema = z.object({
  command: z.string(),
  args: z.array(z.string()),
  headlessFlag: z.string().optional(),
  yoloFlag: z.string().optional(),
});

/**
 * Agent Manifest (ADR-006)
 */
const AgentManifestSchema = PluginBaseSchema.extend({
  type: z.literal("agent"),
  dispatchMode: z.enum(["local-cli", "github-integration"]),
  contextFileName: z.string(),
  invocation: InvocationSchema.optional(),
  capabilities: z.array(z.string()),
  models: z.record(z.string()),
  exitCodeMap: z.record(
    z
      .string()
      .regex(/^\d+$/), // Map key is a number string
    z.object({
      exitCode: z.union([
        z.literal(0),
        z.literal(1),
        z.literal(2),
        z.literal(127),
      ]),
      errorType: z.string().optional(),
    }),
  ),
  managedConfig: z
    .array(
      z.object({
        path: z.string(),
        keys: z.array(z.string()),
      }),
    )
    .default([]),
});

export type IntentAction = "WRITE_FILE" | "CREATE_DIR" | "RUN_COMMAND";

export interface JsonIntent {
  action: IntentAction;
  filePath?: string;
  content?: string;
  dirPath?: string;
  command?: string;
}

/**
 * Workflow Manifest (Layer 2.5)
 */
const WorkflowManifestSchema = PluginBaseSchema.extend({
  type: z.literal("workflow"),
  outputSchema: z.record(z.any()), // JSON Schema
  /**
   * When true, the outputSchema is passed to adapters that enforce structured
   * output at the model level (e.g. Claude's `--json-schema`). Off by default:
   * content-heavy workflows (plan, implement) write their deliverable files
   * natively and the JSON is only a post-hoc report — forcing large structured
   * output there exhausts the model's structured-output retries and fails the
   * run even though the work succeeded. Enable ONLY where the JSON contract
   * itself is the deliverable and the model might otherwise ask questions
   * instead of producing it (e.g. specify).
   */
  enforceOutputSchema: z.boolean().optional().default(false),
});

/**
 * Review Manifest (Layer 3)
 */
const ReviewStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  required: z.boolean().optional(),
  skip: z.boolean().optional(),
});

export type ReviewStep = z.infer<typeof ReviewStepSchema>;

const ReviewManifestSchema = PluginBaseSchema.extend({
  type: z.literal("review"),
  projectType: z.enum(["cli", "webapp"]),
  codeReviewWorkflow: z.string(),
  uatReviewWorkflow: z.string(),
  steps: z.object({
    code: z.array(ReviewStepSchema),
    uat: z.array(ReviewStepSchema),
  }),
});

/**
 * Extension Manifest (Layer 3)
 */
const ExtensionManifestSchema = PluginBaseSchema.extend({
  type: z.literal("extension"),
  provides: z.array(z.enum(["context", "metrics", "search", "notification"])),
  adapter: z.string(), // Path to the adapter entry point
});

/**
 * Any Plugin Manifest (Union of all types)
 * We use z.union instead of z.discriminatedUnion at the top level because
 * SkillManifestSchema is itself a discriminated union, and members of
 * a top-level discriminated union must be object schemas.
 */
export const AnyManifestSchema = z.union([
  SkillManifestSchema,
  AgentManifestSchema,
  WorkflowManifestSchema,
  ReviewManifestSchema,
  ExtensionManifestSchema,
]);

export type AtomicSkillManifest = z.infer<typeof AtomicSkillManifestSchema>;
export type CompoundSkillManifest = z.infer<typeof CompoundSkillManifestSchema>;
export type EnforcementSkillManifest = z.infer<
  typeof EnforcementSkillManifestSchema
>;
export type SkillManifest = z.infer<typeof SkillManifestSchema>;
type AgentManifest = z.infer<typeof AgentManifestSchema>;
export type WorkflowManifest = z.infer<typeof WorkflowManifestSchema>;
export type ReviewManifest = z.infer<typeof ReviewManifestSchema>;
export type ExtensionManifest = z.infer<typeof ExtensionManifestSchema>;
export type AnyManifest = z.infer<typeof AnyManifestSchema>;
