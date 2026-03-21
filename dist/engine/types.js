import { z } from "zod";
export const WeeklyBucketSchema = z.object({
    weekStart: z.string(), // ISO 8601 date (Monday of the week)
    totalMain: z.number(),
    totalDrafts: z.number(),
    added: z.number(),
    deleted: z.number(),
});
export const PulseSnapshotSchema = z.object({
    repoPath: z.string(),
    repoName: z.string(),
    defaultBranch: z.string(),
    scannedAt: z.string(), // ISO timestamp
    mainLoc: z.number(),
    draftLoc: z.number(),
    weeklyBuckets: z.array(WeeklyBucketSchema),
});
export const SpecProgressSchema = z.object({
    totalSpecs: z.number(),
    totalPlans: z.number(),
});
export const PulseReportSchema = z.object({
    generatedAt: z.string(),
    repositories: z.array(PulseSnapshotSchema),
    specProgress: SpecProgressSchema,
});
export const HarvestPayloadSchema = z.object({
    featureId: z.string(),
    phaseId: z.string().optional(),
    prNumber: z.number(),
    mergeCommitSha: z.string(),
    mergedAt: z.string(), // ISO 8601
});
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
