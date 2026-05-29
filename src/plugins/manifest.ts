import { z } from "zod";

/**
 * Shared regex for kebab-case validation
 */
export const KEBAB_CASE_REGEX = /^[a-z0-9-]+$/;

/**
 * Shared regex for semver validation
 */
export const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;

/**
 * Base schema for all plugins
 */
export const PluginBaseSchema = z.object({
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
export const PluginFlagSchema = z.object({
  name: z.string(),
  values: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  default: z.string().optional(),
  description: z.string().optional(),
});

export const PluginInterfaceSchema = z.object({
  input: z.literal("stdin"),
  output: z.literal("stdout"),
  flags: z.array(PluginFlagSchema).optional(),
});

/**
 * Skill Runtime
 */
export const SkillRuntimeSchema = z.object({
  preferredAgent: z.string(),
  preferredModel: z.string(),
  fallbackAgent: z.string().optional(),
  maxInputTokens: z.number().optional(),
  expectedLatency: z.string().optional(),
});

/**
 * Skill Context
 */
export const SkillContextSchema = z.object({
  required: z.array(z.string()).default(["input"]),
  optional: z.array(z.string()).default([]),
});

/**
 * Skill Pass (Compound)
 */
export const SkillPassSchema = z.object({
  name: z.string(),
  skill: z.string(),
  summary: z.string(),
});

/**
 * Atomic Skill Manifest
 */
export const AtomicSkillManifestSchema = PluginBaseSchema.extend({
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
export const CompoundSkillManifestSchema = PluginBaseSchema.extend({
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
export const EnforcementSkillManifestSchema = PluginBaseSchema.extend({
  type: z.literal("skill"),
  tier: z.literal("enforcement"),
  scope: z.enum(["implementation", "review", "all"]),
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
export const InvocationSchema = z.object({
  command: z.string(),
  args: z.array(z.string()),
  headlessFlag: z.string().optional(),
  yoloFlag: z.string().optional(),
});

/**
 * Agent Manifest (ADR-006)
 */
export const AgentManifestSchema = PluginBaseSchema.extend({
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

/**
 * Workflow Manifest (Layer 2.5)
 */
export const WorkflowManifestSchema = PluginBaseSchema.extend({
  type: z.literal("workflow"),
  outputSchema: z.record(z.any()), // JSON Schema
});

/**
 * Review Manifest (Layer 3)
 */
export const ReviewStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  required: z.boolean().optional(),
  skip: z.boolean().optional(),
});

export const ReviewManifestSchema = PluginBaseSchema.extend({
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
  // Future: ExtensionManifestSchema, ChannelManifestSchema
]);

export type AtomicSkillManifest = z.infer<typeof AtomicSkillManifestSchema>;
export type CompoundSkillManifest = z.infer<typeof CompoundSkillManifestSchema>;
export type EnforcementSkillManifest = z.infer<typeof EnforcementSkillManifestSchema>;
export type SkillManifest = z.infer<typeof SkillManifestSchema>;
export type AgentManifest = z.infer<typeof AgentManifestSchema>;
export type WorkflowManifest = z.infer<typeof WorkflowManifestSchema>;
export type ReviewManifest = z.infer<typeof ReviewManifestSchema>;
export type AnyManifest = z.infer<typeof AnyManifestSchema>;
