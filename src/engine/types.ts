import { z } from "zod";

export const WeeklyBucketSchema = z.object({
  weekStart: z.string(), // ISO 8601 date (Monday of the week)
  totalMain: z.number(),
  totalDrafts: z.number(),
  added: z.number(),
  deleted: z.number(),
});
export type WeeklyBucket = z.infer<typeof WeeklyBucketSchema>;

export const PulseSnapshotSchema = z.object({
  repoPath: z.string(),
  repoName: z.string(),
  defaultBranch: z.string(),
  scannedAt: z.string(), // ISO timestamp
  mainLoc: z.number(),
  draftLoc: z.number(),
  weeklyBuckets: z.array(WeeklyBucketSchema),
});
export type PulseSnapshot = z.infer<typeof PulseSnapshotSchema>;

export const SpecProgressSchema = z.object({
  totalSpecs: z.number(),
  totalPlans: z.number(),
});
export type SpecProgress = z.infer<typeof SpecProgressSchema>;

export const PulseReportSchema = z.object({
  generatedAt: z.string(),
  repositories: z.array(PulseSnapshotSchema),
  specProgress: SpecProgressSchema,
});
export type PulseReport = z.infer<typeof PulseReportSchema>;

// --- Effort Engine Types ---

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

// --- Compression Engine Types ---

export interface DeliveryActuals {
  specCreatedAt: string;
  firstImplCommit: string;
  lastImplCommit: string;
  prMergedAt: string;
  dormancyDays: number;
  activeCodingMinutes: number;
  sessionCount: number;
  deliveryWindowHours: number;
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
export interface CompressionReport {
  featureId: string;
  phaseId?: string;
  generatedAt: string;
  forecast: EffortForecast;
  actuals: DeliveryActuals;
  compression: CompressionRatios;
}

export const HarvestPayloadSchema = z.object({
  featureId: z.string(),
  phaseId: z.string().optional(),
  prNumber: z.number(),
  mergeCommitSha: z.string(),
  mergedAt: z.string(), // ISO 8601
});
export type HarvestPayload = z.infer<typeof HarvestPayloadSchema>;

export const CompressionRecordSchema = z.object({
  featureId: z.string(),
  phaseId: z.string().optional(),
  estimatedHours: z.number(),
  actualCodingHours: z.number(),
  estimatedDays: z.number(),
  actualDeliveryDays: z.number(),
  pointCompression: z.number(),
  totalCompression: z.number(),
  dormancyDays: z.number(),
  firstImplCommit: z.string(),
  mergeTimestamp: z.string(),
  sessionCount: z.number(),
  recordedAt: z.string().optional(),
});
export type CompressionRecord = z.infer<typeof CompressionRecordSchema>;

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
  };
  best: { featureId: string; pointCompression: number };
  worst: { featureId: string; pointCompression: number };
  trend: string;
}
