/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { ProjectDesign } from "./architecture-context.js";
import type { ProjectProfile } from "./types.js";

export interface WorkspaceProfileConfig {
  type?: string;
  stack?: { language?: string; framework?: string; buildSystem?: string };
  layout?: string;
  toolchain?: ProjectProfile["toolchain"];
  design?: ProjectDesign;
}

export interface ProfileOverrideInput {
  detected: ProjectProfile;
  projectDesign?: ProjectDesign;
  projectType?: string;
  projectStack?: ProjectProfile["stack"];
  projectLayout?: string;
  projectToolchain?: ProjectProfile["toolchain"];
  workspaceConfig?: WorkspaceProfileConfig;
}

export function mergeProfileOverrides(
  _input: ProfileOverrideInput,
): ProjectProfile & { design?: ProjectDesign } {
  throw new Error("Not implemented");
}

export function resolveWorkspacePolicyProfile(
  _workspaceRelPath: string,
  _detectedWorkspace: ProjectProfile,
  _rootConfig?: {
    project?: { design?: ProjectDesign; toolchain?: ProjectProfile["toolchain"] };
    workspaces?: Readonly<Record<string, WorkspaceProfileConfig>>;
  },
): ProjectProfile & { design?: ProjectDesign } {
  throw new Error("Not implemented");
}
