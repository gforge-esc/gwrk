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
 * Checks if the working tree is clean.
 */
export declare function isWorkingTreeClean(repoPath: string): boolean;
/**
 * Gets the diff stats between current state and a ref (defaults to HEAD~1).
 */
export declare function getDiffStats(repoPath: string, ref?: string): {
    filesChanged: number;
    linesAdded: number;
    linesDeleted: number;
};
