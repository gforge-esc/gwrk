/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { VcsPort } from "../../ports/vcs-port.js";
import {
  createBranch,
  getCurrentBranch,
  isDirty,
  syncBranch,
} from "../../utils/git.js";

export function createGitVcsAdapter(): VcsPort {
  return {
    getCurrentBranch,
    isDirty,
    createBranch,
    syncBranch,
  };
}
