export interface WudState {
  stage: string;
  iteration: number;
  feature: string;
  phase: string;
  trackingIssue?: string;
  prNumber?: number;
  updatedAt: string;
}

export function saveWudState(stateFile: string, state: WudState): void {
  throw new Error("Not implemented");
}

export function loadWudState(stateFile: string): WudState | null {
  throw new Error("Not implemented");
}
