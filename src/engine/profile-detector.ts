/**
 * Auto-detects project type, tech stack, and layout from filesystem signals.
 * FR-030, FR-031, US-027
 */
export type ProjectProfile = any;

export const detectProfile = async (dir: string): Promise<ProjectProfile> => {
  throw new Error("Not implemented");
};
