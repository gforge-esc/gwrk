/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";

/**
 * Resolve a stable project ID for a given directory.
 *
 * The ID must be identical across every checkout of the same repository —
 * the primary working tree AND any linked git worktree (and a remote runner) —
 * so ledger/harvest correlation survives worktree-isolated, parallel shipping.
 * The old scheme hashed the directory path, which differs per worktree.
 *
 * Resolution tiers (first that applies wins), all md5-hashed:
 *   1. `remote:<slug>` — the `origin` remote normalized to `host/owner/repo`
 *      (ssh and https forms collapse to the same slug). Stable across worktrees
 *      and machines.
 *   2. `local:<main-worktree>` — for a git repo with no `origin`, the main
 *      working tree (via `--git-common-dir`), so worktrees still share an ID.
 *   3. `path:<dir>` — non-git directories fall back to the path.
 */
export function resolveProjectId(projectRoot: string): string {
	return crypto.createHash("md5").update(projectKey(projectRoot)).digest("hex");
}

function projectKey(projectRoot: string): string {
	const remote = gitRemoteSlug(projectRoot);
	if (remote) return `remote:${remote}`;

	const mainWorktree = gitMainWorktree(projectRoot);
	if (mainWorktree) return `local:${mainWorktree}`;

	return `path:${projectRoot}`;
}

function git(args: string[], cwd: string): string | null {
	try {
		return execFileSync("git", args, {
			cwd,
			stdio: ["ignore", "pipe", "ignore"],
			encoding: "utf-8",
		}).trim();
	} catch {
		return null;
	}
}

/**
 * Normalize an `origin` URL to `host/owner/repo` so ssh/https/scp forms of the
 * same repository collapse to one slug. Returns null when there is no origin.
 */
function gitRemoteSlug(projectRoot: string): string | null {
	const url = git(["config", "--get", "remote.origin.url"], projectRoot);
	if (!url) return null;

	const s = url.trim().replace(/\.git$/, "");
	// scp-like: git@github.com:owner/repo
	const scp = s.match(/^[^@]+@([^:]+):(.+)$/);
	if (scp) return `${scp[1]}/${scp[2]}`.toLowerCase();
	// url form: ssh://, https://, git://, etc.
	const m = s.match(/^[a-z]+:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/i);
	if (m) return `${m[1]}/${m[2]}`.toLowerCase();
	return s.toLowerCase();
}

/**
 * The main working tree's absolute path for a git repo without an origin, so
 * linked worktrees still resolve to the same key. `--git-common-dir` points at
 * the primary `.git`; its parent is the main working tree.
 */
function gitMainWorktree(projectRoot: string): string | null {
	const commonDir = git(
		["rev-parse", "--path-format=absolute", "--git-common-dir"],
		projectRoot,
	);
	if (!commonDir) return null;
	// commonDir ends in ".git" (or a bare repo dir) → parent is the worktree root
	return path.dirname(commonDir);
}
