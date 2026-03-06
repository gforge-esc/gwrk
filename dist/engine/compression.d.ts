import type { CompressionReport, CompressionRatios, CompressionSummary, DeliveryActuals, EffortForecast } from "./types.js";
/** ... existing exports ... */
export declare function computeCompression(forecast: EffortForecast, actuals: DeliveryActuals): CompressionRatios;
export declare function generateSummary(reports: CompressionReport[]): CompressionSummary;
/**
 * Gathers delivery actuals securely from the filesystem and git.
 */
export declare function gatherDeliveryActuals(featureDir: string, sessionGapMinutes?: number): DeliveryActuals;
