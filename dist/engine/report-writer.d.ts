import type { EffortReport } from "./types.js";
/**
 * Writes the EffortReport object to a markdown assessment document.
 * Returns the absolute path of the generated file.
 */
export declare function writeEffortReport(report: EffortReport, outputDir: string): string;
