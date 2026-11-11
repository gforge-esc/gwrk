/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import crypto from "node:crypto";
import path from "node:path";

export interface ProjectIdentityFacts {
  projectRoot: string;
  remoteOriginUrl?: string | null;
  gitCommonDir?: string | null;
}

export function normalizeGitRemoteSlug(url: string): string | null {
  const remote = url.trim().replace(/\.git$/, "");
  if (!remote) return null;

  const scp = remote.match(/^[^@]+@([^:]+):(.+)$/);
  if (scp) return `${scp[1]}/${scp[2]}`.toLowerCase();

  const uri = remote.match(/^[a-z]+:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/i);
  if (uri) return `${uri[1]}/${uri[2]}`.toLowerCase();

  return remote.toLowerCase();
}

export function computeProjectKey(facts: ProjectIdentityFacts): string {
  const remote = facts.remoteOriginUrl
    ? normalizeGitRemoteSlug(facts.remoteOriginUrl)
    : null;
  if (remote) return `remote:${remote}`;
  if (facts.gitCommonDir) return `local:${path.dirname(facts.gitCommonDir)}`;
  return `path:${facts.projectRoot}`;
}

export function computeProjectId(facts: ProjectIdentityFacts): string {
  return crypto
    .createHash("md5")
    .update(computeProjectKey(facts))
    .digest("hex");
}

export function computeLegacyProjectIds(facts: ProjectIdentityFacts): string[] {
  return [`path:${facts.projectRoot}`, facts.projectRoot].map((key) =>
    crypto.createHash("md5").update(key).digest("hex"),
  );
}
