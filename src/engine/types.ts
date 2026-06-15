import { z } from "zod";

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

export interface CommitCluster {
  id: string;
  start: string; // ISO timestamp
  end: string; // ISO timestamp
  durationMinutes: number;
  commitCount: number;
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
    firstPassRate: number; // %
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

