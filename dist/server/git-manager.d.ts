export declare class GitManager {
    private projectRoot;
    constructor(projectRoot: string);
    private exec;
    createPhaseBranch(featureId: string, phaseId: string): string;
    mergePhaseBack(featureId: string, phaseId: string): void;
    isClean(): boolean;
    deleteBranch(branchName: string): void;
}
