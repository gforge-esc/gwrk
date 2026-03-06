export interface WudState {
    stage: string;
    iteration: number;
    feature: string;
    phase: string;
    trackingIssue?: string;
    prNumber?: number;
    updatedAt: string;
}
export declare function saveWudState(stateFile: string, state: WudState): void;
export declare function loadWudState(stateFile: string): WudState | null;
