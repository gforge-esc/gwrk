/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { canonicalJsonSha256 } from "./canonical-json.ts";

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
] as const;

export interface RuntimeManifestEntry {
  path: string;
  executable: boolean;
  sha256: string;
}

export interface RuntimeManifest {
  schemaVersion: "1.0.0";
  roots: readonly string[];
  entries: RuntimeManifestEntry[];
}

export interface RuntimeManifestResult {
  manifest: RuntimeManifest;
  manifestSha256: string;
}

function normalizePosix(p: string): string {
  return p.split(path.sep).join("/");
}

export function isUnderClosedRoot(relPath: string): boolean {
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

function assertNoSymlinks(dir: string, baseRepo: string): void {
  const entries = readdirSync(dir, { withFileTypes: false });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry as string);
    const relPath = normalizePosix(path.relative(baseRepo, fullPath));
    const stat = lstatSync(fullPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Symlink detected in runtime root: ${relPath}`);
    }
    if (stat.isDirectory()) {
      assertNoSymlinks(fullPath, baseRepo);
    }
  }
}

export async function computeRuntimeManifest(
  repoRoot: string,
): Promise<RuntimeManifestResult> {
  // 1. Verify all 10 closed roots exist and contain zero symlinks
  for (const root of CLOSED_RUNTIME_ROOTS) {
    const fullPath = path.join(repoRoot, root);
    if (!existsSync(fullPath)) {
      throw new Error(`Missing required runtime root: ${root}`);
    }
    const stat = lstatSync(fullPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Symlink detected in runtime root: ${root}`);
    }
    if (stat.isDirectory()) {
      assertNoSymlinks(fullPath, repoRoot);
    }
  }

  // 2. Inspect git working tree status for untracked or dirty files under runtime roots
  const statusRaw = execFileSync("git", ["status", "--porcelain=v1", "-uall"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
    },
  });

  const lines = statusRaw
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
  for (const line of lines) {
    const code = line.slice(0, 2);
    let target = line.slice(3).trim();
    if (target.startsWith('"') && target.endsWith('"')) {
      try {
        target = JSON.parse(target) as string;
      } catch {
        // preserve target as-is if parsing fails
      }
    }
    if (target.includes(" -> ")) {
      target = target.split(" -> ")[1].trim();
    }
    const normalized = normalizePosix(target);
    if (isUnderClosedRoot(normalized)) {
      if (code === "??") {
        throw new Error(`Untracked file in runtime root: ${normalized}`);
      }
      throw new Error(`Dirty runtime file: ${normalized} (status: ${code})`);
    }
  }

  // 3. Collect tracked regular files under closed roots
  const entries: RuntimeManifestEntry[] = [];

  function collectFiles(currentPath: string): void {
    const stat = lstatSync(currentPath);
    const relPath = normalizePosix(path.relative(repoRoot, currentPath));
    if (stat.isSymbolicLink()) {
      throw new Error(`Symlink detected in runtime root: ${relPath}`);
    }
    if (stat.isDirectory()) {
      const children = readdirSync(currentPath);
      for (const child of children) {
        collectFiles(path.join(currentPath, child));
      }
    } else if (stat.isFile()) {
      const bytes = readFileSync(currentPath);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const executable = (stat.mode & 0o111) !== 0;
      entries.push({
        path: relPath,
        executable,
        sha256,
      });
    }
  }

  for (const root of CLOSED_RUNTIME_ROOTS) {
    const fullPath = path.join(repoRoot, root);
    collectFiles(fullPath);
  }

  // 4. Sort entries lexicographically by POSIX path
  entries.sort((a, b) => {
    if (a.path < b.path) return -1;
    if (a.path > b.path) return 1;
    return 0;
  });

  const manifest: RuntimeManifest = {
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
