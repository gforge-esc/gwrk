/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  getColocatedTestCandidates,
  isPolyglotSourceFile,
  isPolyglotTestFile,
} from "../../domain/test-rules.js";
import {
  getSourceExtension,
  getTestCommand,
  getTestExtension,
} from "../../domain/toolchain.js";
import type { ProjectProfile } from "../../domain/types.js";
import type { ToolchainPort } from "../../ports/toolchain-port.js";
import { getBuildCommand } from "./manifest-discovery.js";

export {
  discoverToolchainManifests,
  getBuildCommand,
} from "./manifest-discovery.js";

export function createToolchainAdapter(
  profile: ProjectProfile,
): ToolchainPort {
  const sourceExtension = getSourceExtension(profile);
  const testExtension = getTestExtension(profile);
  return {
    language: profile.stack?.language ?? profile.type,
    sourceExtension,
    testExtension,
    isSourceFile: (f) => isPolyglotSourceFile(f, testExtension),
    isTestFile: (f) => isPolyglotTestFile(f, testExtension),
    colocatedTestCandidates: (src) =>
      getColocatedTestCandidates(src, testExtension),
    getBuildCommand: (cwd) => getBuildCommand(profile, cwd),
    getTestCommand: (files, grepPattern) =>
      getTestCommand(profile, files ?? [], grepPattern),
  };
}
