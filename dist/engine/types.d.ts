import { z } from "zod";
export declare const WeeklyBucketSchema: z.ZodObject<{
    weekStart: z.ZodString;
    totalMain: z.ZodNumber;
    totalDrafts: z.ZodNumber;
    added: z.ZodNumber;
    deleted: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    weekStart: string;
    totalMain: number;
    totalDrafts: number;
    added: number;
    deleted: number;
}, {
    weekStart: string;
    totalMain: number;
    totalDrafts: number;
    added: number;
    deleted: number;
}>;
export type WeeklyBucket = z.infer<typeof WeeklyBucketSchema>;
export declare const PulseSnapshotSchema: z.ZodObject<{
    repoPath: z.ZodString;
    repoName: z.ZodString;
    defaultBranch: z.ZodString;
    scannedAt: z.ZodString;
    mainLoc: z.ZodNumber;
    draftLoc: z.ZodNumber;
    weeklyBuckets: z.ZodArray<z.ZodObject<{
        weekStart: z.ZodString;
        totalMain: z.ZodNumber;
        totalDrafts: z.ZodNumber;
        added: z.ZodNumber;
        deleted: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        weekStart: string;
        totalMain: number;
        totalDrafts: number;
        added: number;
        deleted: number;
    }, {
        weekStart: string;
        totalMain: number;
        totalDrafts: number;
        added: number;
        deleted: number;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    repoPath: string;
    repoName: string;
    defaultBranch: string;
    scannedAt: string;
    mainLoc: number;
    draftLoc: number;
    weeklyBuckets: {
        weekStart: string;
        totalMain: number;
        totalDrafts: number;
        added: number;
        deleted: number;
    }[];
}, {
    repoPath: string;
    repoName: string;
    defaultBranch: string;
    scannedAt: string;
    mainLoc: number;
    draftLoc: number;
    weeklyBuckets: {
        weekStart: string;
        totalMain: number;
        totalDrafts: number;
        added: number;
        deleted: number;
    }[];
}>;
export type PulseSnapshot = z.infer<typeof PulseSnapshotSchema>;
export declare const SpecProgressSchema: z.ZodObject<{
    totalSpecs: z.ZodNumber;
    totalPlans: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    totalSpecs: number;
    totalPlans: number;
}, {
    totalSpecs: number;
    totalPlans: number;
}>;
export type SpecProgress = z.infer<typeof SpecProgressSchema>;
export declare const PulseReportSchema: z.ZodObject<{
    generatedAt: z.ZodString;
    repositories: z.ZodArray<z.ZodObject<{
        repoPath: z.ZodString;
        repoName: z.ZodString;
        defaultBranch: z.ZodString;
        scannedAt: z.ZodString;
        mainLoc: z.ZodNumber;
        draftLoc: z.ZodNumber;
        weeklyBuckets: z.ZodArray<z.ZodObject<{
            weekStart: z.ZodString;
            totalMain: z.ZodNumber;
            totalDrafts: z.ZodNumber;
            added: z.ZodNumber;
            deleted: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            weekStart: string;
            totalMain: number;
            totalDrafts: number;
            added: number;
            deleted: number;
        }, {
            weekStart: string;
            totalMain: number;
            totalDrafts: number;
            added: number;
            deleted: number;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        repoPath: string;
        repoName: string;
        defaultBranch: string;
        scannedAt: string;
        mainLoc: number;
        draftLoc: number;
        weeklyBuckets: {
            weekStart: string;
            totalMain: number;
            totalDrafts: number;
            added: number;
            deleted: number;
        }[];
    }, {
        repoPath: string;
        repoName: string;
        defaultBranch: string;
        scannedAt: string;
        mainLoc: number;
        draftLoc: number;
        weeklyBuckets: {
            weekStart: string;
            totalMain: number;
            totalDrafts: number;
            added: number;
            deleted: number;
        }[];
    }>, "many">;
    specProgress: z.ZodObject<{
        totalSpecs: z.ZodNumber;
        totalPlans: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        totalSpecs: number;
        totalPlans: number;
    }, {
        totalSpecs: number;
        totalPlans: number;
    }>;
}, "strip", z.ZodTypeAny, {
    generatedAt: string;
    repositories: {
        repoPath: string;
        repoName: string;
        defaultBranch: string;
        scannedAt: string;
        mainLoc: number;
        draftLoc: number;
        weeklyBuckets: {
            weekStart: string;
            totalMain: number;
            totalDrafts: number;
            added: number;
            deleted: number;
        }[];
    }[];
    specProgress: {
        totalSpecs: number;
        totalPlans: number;
    };
}, {
    generatedAt: string;
    repositories: {
        repoPath: string;
        repoName: string;
        defaultBranch: string;
        scannedAt: string;
        mainLoc: number;
        draftLoc: number;
        weeklyBuckets: {
            weekStart: string;
            totalMain: number;
            totalDrafts: number;
            added: number;
            deleted: number;
        }[];
    }[];
    specProgress: {
        totalSpecs: number;
        totalPlans: number;
    };
}>;
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
    roles: {
        role: string;
        sp: number;
    }[];
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
export declare const HarvestPayloadSchema: z.ZodObject<{
    featureId: z.ZodString;
    phaseId: z.ZodOptional<z.ZodString>;
    prNumber: z.ZodNumber;
    mergeCommitSha: z.ZodString;
    mergedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    featureId: string;
    prNumber: number;
    mergeCommitSha: string;
    mergedAt: string;
    phaseId?: string | undefined;
}, {
    featureId: string;
    prNumber: number;
    mergeCommitSha: string;
    mergedAt: string;
    phaseId?: string | undefined;
}>;
export type HarvestPayload = z.infer<typeof HarvestPayloadSchema>;
export declare const CompressionRecordSchema: z.ZodObject<{
    featureId: z.ZodString;
    phaseId: z.ZodOptional<z.ZodString>;
    estimatedHours: z.ZodNumber;
    actualCodingHours: z.ZodNumber;
    estimatedDays: z.ZodNumber;
    actualDeliveryDays: z.ZodNumber;
    pointCompression: z.ZodNumber;
    totalCompression: z.ZodNumber;
    dormancyDays: z.ZodNumber;
    firstImplCommit: z.ZodString;
    mergeTimestamp: z.ZodString;
    sessionCount: z.ZodNumber;
    recordedAt: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    featureId: string;
    estimatedHours: number;
    actualCodingHours: number;
    estimatedDays: number;
    actualDeliveryDays: number;
    pointCompression: number;
    totalCompression: number;
    dormancyDays: number;
    firstImplCommit: string;
    mergeTimestamp: string;
    sessionCount: number;
    phaseId?: string | undefined;
    recordedAt?: string | undefined;
}, {
    featureId: string;
    estimatedHours: number;
    actualCodingHours: number;
    estimatedDays: number;
    actualDeliveryDays: number;
    pointCompression: number;
    totalCompression: number;
    dormancyDays: number;
    firstImplCommit: string;
    mergeTimestamp: string;
    sessionCount: number;
    phaseId?: string | undefined;
    recordedAt?: string | undefined;
}>;
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
    best: {
        featureId: string;
        pointCompression: number;
    };
    worst: {
        featureId: string;
        pointCompression: number;
    };
    trend: string;
}
