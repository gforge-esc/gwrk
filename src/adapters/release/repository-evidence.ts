/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { LedgerBackupMetadata } from "../../domain/ledger-backup.js";

type RepositoryEvidence = LedgerBackupMetadata["repositories"][number];

function credentialFreeRemote(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol))
      return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    const scp = /^[^@\s]+@([\w.-]+):([\w./-]+)$/.exec(value);
    return scp ? `ssh://${scp[1]}/${scp[2]}` : null;
  }
}

export function readRepositoryEvidence(
  projectId: string,
  path: string,
): RepositoryEvidence {
  const root = resolve(path);
  const options = {
    cwd: root,
    timeout: 5000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
  };
  const unavailable = {
    projectId,
    root,
    remote: null,
    head: null,
    evidence: [],
  };
  const topLevel = spawnSync("git", ["rev-parse", "--show-toplevel"], options);
  if (topLevel.status !== 0) return unavailable;
  try {
    const gitRoot = topLevel.stdout.toString("utf8").replace(/\n$/, "");
    if (realpathSync(root) !== realpathSync(gitRoot)) return unavailable;
  } catch {
    return unavailable;
  }

  const headResult = spawnSync(
    "git",
    ["rev-parse", "--verify", "HEAD^{commit}"],
    options,
  );
  if (headResult.status !== 0) {
    return unavailable;
  }

  const head = headResult.stdout.toString("utf8").trim();
  const remoteResult = spawnSync(
    "git",
    ["config", "--get", "remote.origin.url"],
    options,
  );
  const remote =
    remoteResult.status === 0
      ? credentialFreeRemote(remoteResult.stdout.toString("utf8").trim())
      : null;
  const files = execFileSync(
    "git",
    ["ls-tree", "-r", "-z", head, "--", "specs"],
    options,
  );
  const evidence: RepositoryEvidence["evidence"] = [];
  for (const entry of files.toString("utf8").split("\0")) {
    const match =
      /^\d+ blob ([a-f0-9]+)\t(specs\/[^/]+\/\.gwrk\/(?:tasks\.json|runs\/[^/]+\.json))$/.exec(
        entry,
      );
    if (!match) continue;
    const content = execFileSync(
      "git",
      ["cat-file", "blob", match[1]],
      options,
    );
    evidence.push({
      path: match[2],
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }
  return { projectId, root, remote, head, evidence };
}
