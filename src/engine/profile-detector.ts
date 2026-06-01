/**
 * FR-030, FR-031: Project Profile Detection
 */

export interface ProjectProfile {
  type: 'pnpm-monorepo' | 'rust-workspace' | 'rust-binary' | 'python-package' | 'gwrk-native' | 'node-package' | 'go-module' | 'unknown';
  stack: {
    language?: string;
    packageManager?: string;
    testFramework?: string;
    buildSystem?: string;
  };
  layout?: {
    src?: string;
    tests?: string;
    specs?: string;
  };
}

export async function detectProfile(_cwd: string): Promise<ProjectProfile> {
  // To be implemented by /implement
  throw new Error('Not implemented');
}

export async function resolveProfile(_cwd: string, _explicitConfig?: Partial<ProjectProfile>): Promise<ProjectProfile> {
  // FR-032: Explicit config overrides auto-detection
  throw new Error('Not implemented');
}
