/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { ProjectDesign } from "./architecture-context.js";
import type { ProjectProfile, WorkspaceProfileConfig } from "./types.js";

export type { WorkspaceProfileConfig } from "./types.js";

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
  input: ProfileOverrideInput,
): ProjectProfile {
  const { detected, workspaceConfig } = input;
  const profile = {
    ...detected,
    type: workspaceConfig?.type ?? input.projectType ?? detected.type,
  };
  const layout = workspaceConfig?.layout ?? input.projectLayout;
  const design = workspaceConfig?.design ?? input.projectDesign;

  if (layout !== undefined) profile.layout = layout;
  if (design !== undefined) profile.design = design;
  if (input.projectStack || workspaceConfig?.stack) {
    profile.stack = {
      ...detected.stack,
      ...input.projectStack,
      ...workspaceConfig?.stack,
    };
  }
  if (input.projectToolchain || workspaceConfig?.toolchain) {
    profile.toolchain = {
      ...detected.toolchain,
      ...input.projectToolchain,
      ...workspaceConfig?.toolchain,
    };
  }
  return profile;
}

export function resolveWorkspacePolicyProfile(
  workspaceRelPath: string,
  detectedWorkspace: ProjectProfile,
  rootConfig?: {
    project?: {
      design?: ProjectDesign;
      toolchain?: ProjectProfile["toolchain"];
    };
    workspaces?: Readonly<Record<string, WorkspaceProfileConfig>>;
  },
): ProjectProfile {
  let bestMatch = "";
  let workspaceConfig: WorkspaceProfileConfig | undefined;
  for (const [workspacePath, config] of Object.entries(
    rootConfig?.workspaces ?? {},
  )) {
    if (
      workspacePath.length > bestMatch.length &&
      (workspaceRelPath === workspacePath ||
        workspaceRelPath.startsWith(`${workspacePath}/`))
    ) {
      bestMatch = workspacePath;
      workspaceConfig = config;
    }
  }

  const rootDesign = rootConfig?.project?.design;
  if (!rootDesign && !workspaceConfig) return detectedWorkspace;

  return mergeProfileOverrides({
    detected: detectedWorkspace,
    projectDesign: detectedWorkspace.design ?? rootDesign,
    projectToolchain: rootConfig?.project?.toolchain,
    workspaceConfig,
  });
}
