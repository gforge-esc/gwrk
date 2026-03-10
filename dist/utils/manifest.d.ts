import { z } from "zod";
export declare const ExecutionManifestSchema: z.ZodObject<{
    runId: z.ZodString;
    feature: z.ZodString;
    phase: z.ZodString;
    command: z.ZodString;
    agent: z.ZodString;
    model: z.ZodString;
    startedAt: z.ZodString;
    finishedAt: z.ZodString;
    durationS: z.ZodNumber;
    exitCode: z.ZodNumber;
    attempt: z.ZodNumber;
    gateResult: z.ZodOptional<z.ZodEnum<["PASS", "FAIL"]>>;
    reviewVerdict: z.ZodOptional<z.ZodEnum<["GO", "NO-GO"]>>;
    filesChanged: z.ZodNumber;
    linesAdded: z.ZodNumber;
    linesDeleted: z.ZodNumber;
    gitCommit: z.ZodString;
    gitBranch: z.ZodString;
}, "strip", z.ZodTypeAny, {
    command: string;
    model: string;
    attempt: number;
    exitCode: number;
    runId: string;
    feature: string;
    phase: string;
    agent: string;
    startedAt: string;
    finishedAt: string;
    durationS: number;
    filesChanged: number;
    linesAdded: number;
    linesDeleted: number;
    gitCommit: string;
    gitBranch: string;
    gateResult?: "PASS" | "FAIL" | undefined;
    reviewVerdict?: "GO" | "NO-GO" | undefined;
}, {
    command: string;
    model: string;
    attempt: number;
    exitCode: number;
    runId: string;
    feature: string;
    phase: string;
    agent: string;
    startedAt: string;
    finishedAt: string;
    durationS: number;
    filesChanged: number;
    linesAdded: number;
    linesDeleted: number;
    gitCommit: string;
    gitBranch: string;
    gateResult?: "PASS" | "FAIL" | undefined;
    reviewVerdict?: "GO" | "NO-GO" | undefined;
}>;
export type ExecutionManifest = z.infer<typeof ExecutionManifestSchema>;
/**
 * Writes an execution manifest to specs/<feature>/.gwrk/runs/
 */
export declare function writeManifest(featureDir: string, manifest: ExecutionManifest): string;
/**
 * Loads all manifests for a feature
 */
export declare function loadManifests(featureDir: string): ExecutionManifest[];
/**
 * Generates a runId following the pattern: <ISO-timestamp>_<command>_<phase-shorthand>
 */
export declare function generateRunId(startedAt: string, command: string, phase: string): string;
