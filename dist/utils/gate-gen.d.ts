import type { Phase } from "./state.js";
export interface GateBrief {
    feature: string;
    projectType: "gwrk-typescript";
    tasks: TaskBrief[];
}
export interface TaskBrief {
    taskId: string;
    title: string;
    description: string;
    primaryFile: string | null;
    fileType: "typescript" | "test" | "shell" | "markdown" | "json" | "config" | "unknown";
    identifiers: string[];
    doneWhenCommands: string[];
    contractRefs: string[];
}
/**
 * generateGateBrief — produce a structured JSON brief for LLM gate authoring.
 *
 * This replaces the old generateGates() (ADR-005). The brief describes what
 * each task touches (files, types, identifiers) so the LLM agent can write
 * functional assertions. The brief is context for the LLM, not production gates.
 *
 * Returns the path to the written brief JSON file.
 */
export declare function generateGateBrief(featureDir: string, phases: Phase[], feature: string): string;
export declare function generateRunner(gatesDir: string): void;
/**
 * lintGateScript — detect hollow gates that violate ADR-005 gate quality rules.
 *
 * Returns an array of violation strings. Empty array = gate is valid.
 */
export declare function lintGateScript(content: string): string[];
/**
 * lintAllGates — scan all gate scripts in a directory and return violations.
 *
 * Returns a map of gate filename → violations. Only includes gates with violations.
 */
export declare function lintAllGates(gatesDir: string): Map<string, string[]>;
export interface GapMatrixRow {
    ac: string;
    criterion: string;
    testType: "unit" | "functional" | "e2e" | "structural";
    testFile: string | null;
    testExists: boolean;
    gate: string | null;
}
/**
 * parseGapMatrix — read and parse a gap-matrix.md file.
 *
 * Parses the markdown table format defined in contracts/gap-matrix.md.
 * Returns an array of GapMatrixRow objects.
 */
export declare function parseGapMatrix(gapMatrixPath: string): GapMatrixRow[];
/**
 * generateVitestGates — produce deterministic gate scripts from a gap matrix.
 *
 * For each gap matrix row where testExists is true and testType is
 * unit/functional/e2e, generates a gate script that invokes
 * `pnpm vitest run <file> --grep "<AC>"`.
 *
 * Respects # AUTHORED preservation — existing gates are never overwritten.
 * Returns counts of generated and skipped gates.
 */
export declare function generateVitestGates(featureDir: string, gapMatrixPath: string, _phases: Phase[]): {
    generated: number;
    skipped: number;
};
