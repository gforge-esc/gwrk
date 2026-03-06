import type { StoryEstimate } from "./types.js";
/**
 * Extracts User Stories from a markdown specification.
 * Matches headers like: `### US-001 - Title [5 SP, TS, PE]`
 */
export declare function extractStories(featureDir: string): StoryEstimate[];
