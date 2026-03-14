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
 * Gets the diff stats between current state and a ref (defaults to HEAD~1).
 */
export function getDiffStats(
  repoPath: string,
  ref = "HEAD~1",
): { filesChanged: number; linesAdded: number; linesDeleted: number } {
  try {
    const stdout = execFileSync("git", ["diff", "--numstat", ref], {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    let filesChanged = 0;
    let linesAdded = 0;
    let linesDeleted = 0;

    const lines = stdout.trim().split("\n").filter(Boolean);
    filesChanged = lines.length;

    for (const line of lines) {
      const [added, deleted] = line.split(/\s+/);
      if (added !== "-") linesAdded += Number.parseInt(added, 10);
      if (deleted !== "-") linesDeleted += Number.parseInt(deleted, 10);
    }

    return { filesChanged, linesAdded, linesDeleted };
  } catch (_e) {
    return { filesChanged: 0, linesAdded: 0, linesDeleted: 0 };
  }
}
