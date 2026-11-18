/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { VcsHarvestExtensions, VcsPort } from "../../ports/vcs-port.js";
import {
  createBranch,
  getCurrentBranch,
  isDirty,
  syncBranch,
} from "../../utils/git.js";

import { createGitHarvestAdapter } from "./harvest-git.js";

export { discoverGitIdentityFacts, resolveProjectId } from "./project-id.js";

export function createGitVcsAdapter(): Pick<
  VcsPort,
  "getCurrentBranch" | "isDirty" | "createBranch" | "syncBranch"
> &
  VcsHarvestExtensions {
  return {
    ...createGitHarvestAdapter(),
    getCurrentBranch,
    isDirty,
    createBranch,
    syncBranch,
  };
}
