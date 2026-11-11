/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { ProjectProfile } from "../../domain/types.js";
import { createToolchainAdapter as createToolchainPort } from "../../ports/toolchain-port.js";
import { getBuildCommand } from "./manifest-discovery.js";

export {
  discoverToolchainManifests,
  getBuildCommand,
} from "./manifest-discovery.js";

export function createToolchainAdapter(profile: ProjectProfile) {
  return createToolchainPort(profile, (cwd) => getBuildCommand(profile, cwd));
}
