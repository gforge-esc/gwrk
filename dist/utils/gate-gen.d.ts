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
