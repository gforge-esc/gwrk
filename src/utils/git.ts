import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Auto-detects the default branch of a repository.
 * Tries `git symbolic-ref refs/remotes/origin/HEAD` first.
 * Then falls back to checking if 'main', 'master', or 'trunk' exist.
 */
export function detectDefaultBranch(repoPath: string): string {
  try {
    const stdout = execFileSync(
      "git",
      ["symbolic-ref", "refs/remotes/origin/HEAD"],
      { cwd: repoPath, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const ref = stdout.toString().trim();
    return ref.split("/").pop() ?? "main";
  } catch (_e) {
    // Fallback: list local branches and look for main/master/trunk
    const stdout = execFileSync(
      "git",
      ["branch", "--format=%(refname:short)"],
      {
        cwd: repoPath,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const branches = stdout
      .toString()
      .split("\n")
      .map((b) => b.replace(/^\*\s*/, "").trim())
      .filter(Boolean);

    if (branches.includes("main")) return "main";
    if (branches.includes("master")) return "master";
    if (branches.includes("trunk")) return "trunk";

    throw new Error(
      `Cannot detect default branch for ${repoPath}. Use --branch <name>`,
    );
  }
}

/**
 * Gets raw git log output formatted for parsing.
 */
export function gitLog(repoPath: string): string {
  return execFileSync(
    "git",
    ["log", "--all", "--numstat", "--date=iso-strict", "--format=%H|%aI"],
    { cwd: repoPath, encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 },
  ).toString();
}

/**
 * Lists all branch names in the repository.
 */
export function gitBranches(repoPath: string): string[] {
  const stdout = execFileSync(
    "git",
    ["branch", "-a", "--format=%(refname:short)"],
    {
      cwd: repoPath,
      encoding: "utf-8",
    },
  );
  return stdout
    .toString()
    .split("\n")
    .map((b) => b.replace(/^\*\s*/, "").trim())
    .filter(Boolean);
}

/**
 * Counts total lines of code at a specific ref using ls-files and wc.
 */
export function gitLineCount(repoPath: string, ref: string): number {
  try {
    // This pipeline counts lines in all tracked files at the given ref.
    // We use a shell command to pipe git archive into tar and wc.
    // (git ls-files doesn't work well for bare refs, so we check out to index or use archive)
    // A simpler approximation for active repo is `git ls-files | xargs wc -l`

    // For FR-003, we need LOC at a specific ref.
    // git ls-tree -r $ref --name-only | xargs git show | wc -l
    const stdout = execFileSync(
      "bash",
      [
        "-c",
        `git ls-tree -r ${ref} --name-only | grep -v 'png\\|jpg\\|jpeg\\|gif\\|webp\\|mp4\\|mov' | xargs -I {} git show ${ref}:"{}" 2>/dev/null | wc -l`,
      ],
      { cwd: repoPath, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return Number.parseInt(stdout.toString().trim(), 10) || 0;
  } catch (_e) {
    return 0;
  }
}

/**
 * Counts total lines of code added in draft/feature branches that are not merged into defaultBranch.
 */
export function gitDraftLineCount(
  repoPath: string,
  defaultBranch: string,
): number {
  try {
    // Get all branches except the default
    const stdout = execFileSync(
      "git",
      ["branch", "--format=%(refname:short)"],
      {
        cwd: repoPath,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const branches = stdout
      .toString()
      .split("\n")
      .map((b) => b.trim())
      .filter((b) => b && b !== defaultBranch);
    let totalDraftLines = 0;

    for (const branch of branches) {
      try {
        // diff --shortstat main...feature
        const diffOut = execFileSync(
          "git",
          ["diff", "--shortstat", `${defaultBranch}...${branch}`],
          {
            cwd: repoPath,
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "pipe"],
          },
        );

        // Output looks like: " 2 files changed, 10 insertions(+), 2 deletions(-)"
        const insertionsMatch = diffOut.toString().match(/(\d+)\s+insertion/);
        if (insertionsMatch?.[1]) {
          totalDraftLines += Number.parseInt(insertionsMatch[1], 10);
        }
      } catch (e) {
        // diff might fail if branch has no history in common, etc. Just skip.
      }
    }

    return totalDraftLines;
  } catch (_e) {
    return 0;
  }
}

/**
 * Gets the current commit hash (HEAD).
 */
export function getCurrentCommit(repoPath: string): string {
  try {
    const stdout = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return stdout.trim();
  } catch (_e) {
    return "unknown";
  }
}

/**
 * Gets the current branch name.
 */
export function getCurrentBranch(repoPath: string): string {
  try {
    const stdout = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return stdout.trim();
  } catch (_e) {
    return "unknown";
  }
}

/**
 * Gets diff stats between two refs (or between a ref and its parent if only one is provided).
 */
export function getDiffStats(
  repoPath: string,
  ref: string,
): { filesChanged: number; linesAdded: number; linesDeleted: number } {
  try {
    const stdout = execFileSync("git", ["diff", "--shortstat", ref], {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = stdout.toString().trim();
    if (!output) {
      return { filesChanged: 0, linesAdded: 0, linesDeleted: 0 };
    }

    // Output looks like: " 2 files changed, 10 insertions(+), 2 deletions(-)"
    const filesMatch = output.match(/(\d+)\s+file/);
    const insertionsMatch = output.match(/(\d+)\s+insertion/);
    const deletionsMatch = output.match(/(\d+)\s+deletion/);

    return {
      filesChanged: filesMatch ? Number.parseInt(filesMatch[1], 10) : 0,
      linesAdded: insertionsMatch ? Number.parseInt(insertionsMatch[1], 10) : 0,
      linesDeleted: deletionsMatch ? Number.parseInt(deletionsMatch[1], 10) : 0,
    };
  } catch (_e) {
    return { filesChanged: 0, linesAdded: 0, linesDeleted: 0 };
  }
}

/**
 * Checks if the working tree is dirty (has uncommitted changes).
 */
export async function isDirty(repoPath: string): Promise<boolean> {
  try {
    const stdout = execFileSync("git", ["status", "--porcelain"], {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return stdout.trim().length > 0;
  } catch (_e) {
    return true; // Assume dirty on error for safety
  }
}

/**
 * Creates a new branch from a base branch.
 */
export async function createBranch(
  repoPath: string,
  branchName: string,
  baseBranch = "develop",
): Promise<void> {
  // First ensure base branch exists and is up to date
  execFileSync("git", ["fetch", "origin", baseBranch], {
    cwd: repoPath,
    stdio: ["ignore", "ignore", "pipe"],
  });

  // Create branch from baseBranch but do NOT track it as upstream.
  // The upstream should be origin/<branchName>, not origin/develop.
  // gitPush() sets the correct upstream on first push via -u.
  execFileSync(
    "git",
    ["checkout", "-b", branchName, "--no-track", `origin/${baseBranch}`],
    {
      cwd: repoPath,
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
}

/**
 * Syncs the current branch with a target branch (e.g., develop).
 */
export async function syncBranch(
  repoPath: string,
  targetBranch = "develop",
): Promise<void> {
  execFileSync("git", ["fetch", "origin", targetBranch], {
    cwd: repoPath,
    stdio: ["ignore", "ignore", "pipe"],
  });

  execFileSync("git", ["merge", `origin/${targetBranch}`], {
    cwd: repoPath,
    stdio: ["ignore", "ignore", "pipe"],
  });
}

/**
 * Checks if the working tree is clean.
 */
export function isWorkingTreeClean(repoPath: string): boolean {
  try {
    const stdout = execFileSync("git", ["status", "--porcelain"], {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return stdout.trim() === "";
  } catch (_e) {
    return false;
  }
}

/**
 * Stages and commits specific files.
 */
export function commitFiles(
  repoPath: string,
  files: string[],
  message: string,
): void {
  try {
    // Stage files
    execFileSync("git", ["add", ...files], {
      cwd: repoPath,
      stdio: ["ignore", "ignore", "pipe"],
    });

    // Commit
    execFileSync("git", ["commit", "-m", message], {
      cwd: repoPath,
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (e) {
    // If there's nothing to commit, git commit will exit with non-zero
    // but that's not necessarily an error we want to fail on.
    const err = e as { stderr?: string };
    if (
      err.stderr?.includes("nothing to commit") ||
      err.stderr?.includes("no changes added to commit")
    ) {
      return;
    }
    throw e;
  }
}

/**
 * Pushes the current branch to origin.
 */
export function gitPush(repoPath: string, remote = "origin"): void {
  const branch = getCurrentBranch(repoPath);
  // Always use -u to set upstream to origin/<branch> (not origin/develop).
  execFileSync("git", ["push", "-u", remote, branch], {
    cwd: repoPath,
    stdio: ["ignore", "ignore", "pipe"],
  });
}

/**
 * Deletes a branch from origin.
 */
export function deleteRemoteBranch(
  repoPath: string,
  branch: string,
  remote = "origin",
): void {
  try {
    execFileSync("git", ["push", remote, "--delete", branch], {
      cwd: repoPath,
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (e) {
    // Log error but don't fail, as per FR-H08
    console.error(`Failed to delete remote branch ${branch}:`, e);
  }
}
