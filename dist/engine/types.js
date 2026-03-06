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
