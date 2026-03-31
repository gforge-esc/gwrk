/**
 * Auto-detects the default branch of a repository.
 * Tries `git symbolic-ref refs/remotes/origin/HEAD` first.
 * Then falls back to checking if 'main', 'master', or 'trunk' exist.
 */
export declare function detectDefaultBranch(repoPath: string): string;
/**
 * Gets raw git log output formatted for parsing.
 */
export declare function gitLog(repoPath: string): string;
/**
 * Lists all branch names in the repository.
 */
export declare function gitBranches(repoPath: string): string[];
/**
 * Counts total lines of code at a specific ref using ls-files and wc.
 */
export declare function gitLineCount(repoPath: string, ref: string): number;
/**
 * Counts total lines of code added in draft/feature branches that are not merged into defaultBranch.
 */
export declare function gitDraftLineCount(repoPath: string, defaultBranch: string): number;
/**
 * Gets the current commit hash (HEAD).
 */
export declare function getCurrentCommit(repoPath: string): string;
/**
 * Gets the current branch name.
 */
export declare function getCurrentBranch(repoPath: string): string;
/**
 * Gets diff stats between two refs (or between a ref and its parent if only one is provided).
 */
export declare function getDiffStats(repoPath: string, ref: string): {
    filesChanged: number;
    linesAdded: number;
    linesDeleted: number;
};
/**
 * Checks if the working tree is dirty (has uncommitted changes).
 */
export declare function isDirty(repoPath: string): Promise<boolean>;
/**
 * Creates a new branch from a base branch.
 */
export declare function createBranch(repoPath: string, branchName: string, baseBranch?: string): Promise<void>;
/**
 * Syncs the current branch with a target branch (e.g., develop).
 */
export declare function syncBranch(repoPath: string, targetBranch?: string): Promise<void>;
/**
 * Checks if the working tree is clean.
 */
export declare function isWorkingTreeClean(repoPath: string): boolean;
/**
 * Stages and commits specific files.
 */
export declare function commitFiles(repoPath: string, files: string[], message: string): void;
/**
 * Pushes the current branch to origin.
 */
export declare function gitPush(repoPath: string, remote?: string): void;
/**
 * Deletes a branch from origin.
 */
export declare function deleteRemoteBranch(repoPath: string, branch: string, remote?: string): void;
