/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { canonicalJsonSha256 } from "./canonical-json.mjs";

export const CLOSED_RUNTIME_ROOTS = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "src/",
  "deploy/hosted-pilot/",
  "deploy/hosted-auth-proof/",
  "deploy/linux-runner/",
  "tests/hosted-pilot/",
  "tests/hosted-auth-proof/",
];

function normalizePosix(p) {
  return p.split(path.sep).join("/");
}

function stripTrailingSlash(p) {
  return p.endsWith("/") || p.endsWith("\\") ? p.slice(0, -1) : p;
}

export function isUnderClosedRoot(relPath) {
  const normalized = normalizePosix(relPath);
  for (const root of CLOSED_RUNTIME_ROOTS) {
    if (root.endsWith("/")) {
      if (normalized.startsWith(root) || `${normalized}/` === root) {
        return true;
      }
    } else if (normalized === root) {
      return true;
    }
  }
  return false;
}

function assertNoSymlinksInDir(dir, baseRepo) {
  const entries = readdirSync(dir, { withFileTypes: false });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const relPath = normalizePosix(path.relative(baseRepo, fullPath));
    const stat = lstatSync(fullPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Symlink detected in runtime root: ${relPath}`);
    }
    if (stat.isDirectory()) {
      assertNoSymlinksInDir(fullPath, baseRepo);
    }
  }
}

function verifyRootPathSegments(repoRoot, root) {
  const normalized = normalizePosix(root);
  const cleanPath = stripTrailingSlash(normalized);
  const segments = cleanPath.split("/").filter(Boolean);

  let currentRel = "";
  for (const segment of segments) {
    currentRel = currentRel ? `${currentRel}/${segment}` : segment;
    const currentAbs = path.join(repoRoot, currentRel);
    if (!existsSync(currentAbs)) {
      throw new Error(
        `Missing required runtime root or path segment: ${currentRel}`,
      );
    }
    const stat = lstatSync(currentAbs);
    if (stat.isSymbolicLink()) {
      throw new Error(
        `Symlink detected in runtime root path segment: ${currentRel}`,
      );
    }
  }

  const targetAbs = path.join(repoRoot, cleanPath);
  const targetStat = lstatSync(targetAbs);
  if (root.endsWith("/")) {
    if (!targetStat.isDirectory()) {
      throw new Error(
        `Expected directory for closed root '${root}', but got non-directory`,
      );
    }
    assertNoSymlinksInDir(targetAbs, repoRoot);
  } else {
    if (!targetStat.isFile()) {
      throw new Error(
        `Expected regular file for closed root '${root}', but got non-file`,
      );
    }
  }
}

function getSanitizedGitEnv() {
  const gitEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  gitEnv.GIT_TERMINAL_PROMPT = "0";
  return gitEnv;
}

export async function computeRuntimeManifest(repoRoot) {
  const gitEnv = getSanitizedGitEnv();

  // 1. Verify all 10 closed roots exist and contain zero symlinks along any path segment
  for (const root of CLOSED_RUNTIME_ROOTS) {
    verifyRootPathSegments(repoRoot, root);
  }

  // 2. Check git status with -z and --ignored=matching to reject untracked, ignored, and dirty files
  const statusBuffer = execFileSync(
    "git",
    ["status", "--porcelain=v1", "-z", "-uall", "--ignored=matching"],
    {
      cwd: repoRoot,
      env: gitEnv,
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  const tokens = [];
  let start = 0;
  for (let i = 0; i < statusBuffer.length; i++) {
    if (statusBuffer[i] === 0) {
      tokens.push(statusBuffer.subarray(start, i).toString("utf8"));
      start = i + 1;
    }
  }
  if (start < statusBuffer.length) {
    tokens.push(statusBuffer.subarray(start).toString("utf8"));
  }

  for (let idx = 0; idx < tokens.length; idx++) {
    const token = tokens[idx];
    if (!token) continue;
    const code = token.slice(0, 2);
    const targetPath = token.slice(3);

    const isRenameOrCopy =
      code[0] === "R" || code[1] === "R" || code[0] === "C" || code[1] === "C";

    let origPath = null;
    if (isRenameOrCopy && idx + 1 < tokens.length) {
      origPath = tokens[++idx];
    }

    const pathsToCheck = [targetPath];
    if (origPath) pathsToCheck.push(origPath);

    for (const p of pathsToCheck) {
      const normalized = normalizePosix(p);
      if (isUnderClosedRoot(normalized)) {
        if (code === "??") {
          throw new Error(`Untracked file in runtime root: ${normalized}`);
        }
        if (code === "!!") {
          throw new Error(
            `Untracked or ignored file in runtime root: ${normalized}`,
          );
        }
        throw new Error(`Dirty runtime file: ${normalized} (status: ${code})`);
      }
    }
  }

  // 3. Collect tracked regular files under closed roots from git ls-files -z --stage
  const lsBuffer = execFileSync("git", ["ls-files", "-z", "--stage"], {
    cwd: repoRoot,
    env: gitEnv,
    maxBuffer: 64 * 1024 * 1024,
  });

  const trackedRegularFiles = new Map();
  let lsStart = 0;
  for (let i = 0; i < lsBuffer.length; i++) {
    if (lsBuffer[i] === 0) {
      const record = lsBuffer.subarray(lsStart, i).toString("utf8");
      lsStart = i + 1;
      if (!record) continue;
      const tabIdx = record.indexOf("\t");
      if (tabIdx === -1) continue;
      const meta = record.slice(0, tabIdx);
      const filePath = record.slice(tabIdx + 1);
      const [fileMode, fileBlobSha] = meta.split(" ");
      const normalizedPath = normalizePosix(filePath);
      if (isUnderClosedRoot(normalizedPath)) {
        trackedRegularFiles.set(normalizedPath, {
          mode: fileMode,
          sha: fileBlobSha,
        });
      }
    }
  }

  // 4. Collect actual files on disk under closed roots
  const diskFiles = new Map();

  function collectFiles(currentPath) {
    const cleanCurrent = stripTrailingSlash(currentPath);
    const stat = lstatSync(cleanCurrent);
    const relPath = normalizePosix(path.relative(repoRoot, cleanCurrent));
    if (stat.isSymbolicLink()) {
      throw new Error(`Symlink detected in runtime root: ${relPath}`);
    }
    if (stat.isDirectory()) {
      const children = readdirSync(cleanCurrent);
      for (const child of children) {
        collectFiles(path.join(cleanCurrent, child));
      }
    } else if (stat.isFile()) {
      const bytes = readFileSync(cleanCurrent);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const executable = (stat.mode & 0o111) !== 0;
      diskFiles.set(relPath, { executable, sha256 });
    }
  }

  for (const root of CLOSED_RUNTIME_ROOTS) {
    const fullPath = path.join(repoRoot, root);
    collectFiles(fullPath);
  }

  // 5. Verify exact disk file set equals git tracked regular files under closed roots
  for (const [diskPath] of diskFiles) {
    if (!trackedRegularFiles.has(diskPath)) {
      throw new Error(`Untracked file in runtime root: ${diskPath}`);
    }
  }
  for (const [trackedPath, { mode }] of trackedRegularFiles) {
    if (!diskFiles.has(trackedPath)) {
      throw new Error(
        `Missing tracked file on disk under runtime root: ${trackedPath}`,
      );
    }
    if (mode === "120000") {
      throw new Error(`Tracked symlink in runtime root: ${trackedPath}`);
    }
    if (mode !== "100644" && mode !== "100755") {
      throw new Error(
        `Invalid file mode for tracked file in runtime root: ${trackedPath} (${mode})`,
      );
    }
  }

  if (diskFiles.size !== trackedRegularFiles.size) {
    throw new Error(
      `Disk file count (${diskFiles.size}) does not match tracked git file count (${trackedRegularFiles.size}) under closed roots`,
    );
  }

  // 6. Build and sort entries lexicographically by POSIX path
  const entries = [];
  for (const [filePath, { executable, sha256 }] of diskFiles) {
    entries.push({
      path: filePath,
      executable,
      sha256,
    });
  }

  entries.sort((a, b) => {
    if (a.path < b.path) return -1;
    if (a.path > b.path) return 1;
    return 0;
  });

  const manifest = {
    schemaVersion: "1.0.0",
    roots: CLOSED_RUNTIME_ROOTS,
    entries,
  };

  const manifestSha256 = canonicalJsonSha256(manifest);

  return {
    manifest,
    manifestSha256,
  };
}
