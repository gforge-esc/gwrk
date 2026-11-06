/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { z } from "zod";

export interface ProjectProfile {
  type: string;
  stack?: {
    language?: string;
    languages?: string[];
    framework?: string;
    buildSystem?: string;
  };
  layout?: string;
  toolchain?: {
    primary?:
      | "biome"
      | "eslint"
      | "ruff"
      | "golangci-lint"
      | "clippy"
      | "cargo";
    formatter?: "prettier" | "biome" | "black" | "rustfmt" | "gofmt";
    test?:
      | "vitest"
      | "jest"
      | "pytest"
      | "cargo-test"
      | "go-test"
      | "node-test"
      | null;
    testCommand?: string;
    build?: string | null;
    testExtension?: string;
    sourceExtension?: string;
  };
  _isGwrk?: boolean;
}

export enum TaskClassification {
  THINKING = "thinking",
  FAST = "fast",
  HIGH_CONTEXT = "high-context",
}

export enum TaskType {
  IMPLEMENT = "implement",
  TEST = "test",
  REVIEW = "review",
  DEFINE = "define",
  REMEDIATION = "remediation",
}

export function classifyTask(taskType: string | TaskType): TaskClassification {
  switch (taskType) {
    case TaskType.REVIEW:
      return TaskClassification.THINKING;
    case TaskType.IMPLEMENT:
    case TaskType.REMEDIATION:
    case TaskType.TEST:
      return TaskClassification.FAST;
    case TaskType.DEFINE:
      return TaskClassification.THINKING;
    default:
      return TaskClassification.FAST;
  }
}

export interface WeeklyBucket {
  weekStart: string;
  totalMain: number;
  totalDrafts: number;
  added: number;
  deleted: number;
}

export const PulseSnapshotSchema = z.object({
  repoPath: z.string(),
  repoName: z.string(),
  defaultBranch: z.string(),
  scannedAt: z.string(),
  mainLoc: z.number(),
  draftLoc: z.number(),
  weeklyBuckets: z.array(z.any()),
});
export type PulseSnapshot = z.infer<typeof PulseSnapshotSchema>;

export interface SpecProgress {
  totalSpecs: number;
  totalPlans: number;
}

export const PulseReportSchema = z.object({
  generatedAt: z.string(),
  repositories: z.array(PulseSnapshotSchema),
  specProgress: z.any(),
});
export type PulseReport = z.infer<typeof PulseReportSchema>;

export interface RoleConfig {
  role: string;
  roleName: string;
  hoursPerSP: number;
}

export interface StoryEstimate {
  storyId: string;
  title: string;
  sp: number;
  roles: string[];
  rawHours: number;
  withOverhead: number;
  unestimated?: boolean;
  priority?: string;
}

export interface RoleBreakdown {
  role: string;
  roleName: string;
  hoursPerSP: number;
  spAssigned: number;
  rawHours: number;
  withOverhead: number;
  days: number;
}

export interface EffortReport {
  featureId: string;
  generatedAt: string;
  totalSP: number;
  overheadFactor: number;
  roles: RoleBreakdown[];
  stories: StoryEstimate[];
  totalRawHours: number;
  totalWithOverhead: number;
  totalDays: number;
}

export interface CommitCluster {
  id: string;
  start: string;
  end: string;
  durationMinutes: number;
  commitCount: number;
}

export interface DeliveryActuals {
  specCreatedAt: string;
  firstImplCommit: string;
  lastImplCommit: string;
  prMergedAt: string;
  dormancyDays: number;
  activeCodingMinutes: number;
  sessionCount: number;
  deliveryWindowHours: number;
  clusters?: CommitCluster[];
}

export interface CompressionRatios {
  pointCompression: number;
  totalCompression: number;
  dormancyDays: number;
}

export interface EffortForecast {
  totalSP: number;
  roles: { role: string; sp: number }[];
  estimatedHours: number;
  estimatedDays: number;
}

export interface LeadingIndicators {
  convergence: {
    firstPassRate: number;
    avgAttempts: number;
  };
  density: {
    linesPerSP: number;
    filesPerSP: number;
    toolCallsPerSP: number;
  };
  specQuality: {
    contractCount: number;
    gateCount: number;
  };
}

export interface CompressionReport {
  featureId: string;
  phaseId?: string;
  generatedAt: string;
  forecast: EffortForecast;
  actuals: DeliveryActuals;
  compression: CompressionRatios;
  indicators?: LeadingIndicators;
}

export interface HarvestRecord {
  featureId: string;
  phaseId?: string;
  prNumber: number;
  prUrl: string;
  mergeCommitSha: string;
  mergedAt: string;
  mergedBy: string;
  status: "merged" | "closed";
  headBranch?: string;
}

export interface CompressionSummary {
  projectName: string;
  generatedAt: string;
  features: CompressionReport[];
  totals: {
    totalSP: number;
    totalEstimatedHours: number;
    totalActualCodingHours: number;
    avgPointCompression: number;
    avgTotalCompression: number;
    avgFirstPassRate?: number;
    avgAvgAttempts?: number;
    avgLinesPerSP?: number;
    avgFilesPerSP?: number;
    avgToolCallsPerSP?: number;
    totalContracts?: number;
    totalGates?: number;
  };
  best: { featureId: string; pointCompression: number };
  worst: { featureId: string; pointCompression: number };
  trend: string;
}
