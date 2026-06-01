/**
 * FR-030, FR-031, US-027: Auto-detect project type and tech stack from filesystem signals.
 */

export type ProjectType = "pnpm-monorepo" | "rust-workspace" | "rust-binary" | "python-package" | "gwrk-native" | "unknown";

export interface ProjectProfile {
  type: ProjectType;
  stack: {
    language?: string;
    packageManager?: string;
    testFramework?: string;
    buildSystem?: string;
  };
  layout?: Record<string, string>;
  architecture?: string;
  conventions?: string;
}

export const detectProfile = async (dir: string): Promise<ProjectProfile> => {
  throw new Error("Not implemented");
};