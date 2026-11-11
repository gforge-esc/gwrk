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

const runnerLanguages = {
  vitest: "javascript",
  jest: "javascript",
  "node-test": "javascript",
  pytest: "python",
  "cargo-test": "rust",
  "go-test": "go",
} satisfies Record<
  NonNullable<NonNullable<ProjectProfile["toolchain"]>["test"]>,
  string
>;

function languageFamily(stack: ProjectProfile["stack"]): string | undefined {
  const language =
    stack?.language?.toLowerCase() || stack?.languages?.[0]?.toLowerCase();
  return language === "typescript" ? "javascript" : language;
}

function compatibleRootToolchain(
  toolchain: ProjectProfile["toolchain"],
  rootStack: ProjectProfile["stack"],
  workspaceStack: ProjectProfile["stack"],
): ProjectProfile["toolchain"] {
  if (!toolchain) return undefined;

  const rootLanguage = languageFamily(rootStack);
  const workspaceLanguage = languageFamily(workspaceStack);
  const { test, testCommand: _command, ...defaults } = toolchain;
  const runnerLanguage = test ? runnerLanguages[test] : undefined;

  if (
    workspaceLanguage &&
    ((rootLanguage && rootLanguage !== workspaceLanguage) ||
      (runnerLanguage && runnerLanguage !== workspaceLanguage))
  ) {
    return Object.keys(defaults).length ? defaults : undefined;
  }
  return toolchain;
}

function mergeToolchain(
  base: ProjectProfile["toolchain"],
  override: ProjectProfile["toolchain"],
): NonNullable<ProjectProfile["toolchain"]> {
  if (override?.test === undefined && override?.testCommand === undefined) {
    return { ...base, ...override };
  }
  const { test: _runner, testCommand: _command, ...shared } = base ?? {};
  return { ...shared, ...override };
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
    profile.toolchain = mergeToolchain(
      mergeToolchain(detected.toolchain, input.projectToolchain),
      workspaceConfig?.toolchain,
    );
  }
  return profile;
}

export function resolveWorkspacePolicyProfile(
  workspaceRelPath: string,
  detectedWorkspace: ProjectProfile,
  rootConfig?: {
    project?: {
      design?: ProjectDesign;
      stack?: ProjectProfile["stack"];
      toolchain?: ProjectProfile["toolchain"];
    };
    workspaces?: Readonly<Record<string, WorkspaceProfileConfig>>;
  },
  options?: { requireDesign: boolean },
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
  const hasDesign =
    rootDesign !== undefined ||
    detectedWorkspace.design !== undefined ||
    workspaceConfig?.design !== undefined;
  if (!hasDesign && (options?.requireDesign || !workspaceConfig)) {
    return detectedWorkspace;
  }

  const rootToolchain = hasDesign
    ? compatibleRootToolchain(
        rootConfig?.project?.toolchain,
        rootConfig?.project?.stack,
        { ...detectedWorkspace.stack, ...workspaceConfig?.stack },
      )
    : undefined;
  const detected = rootToolchain
    ? {
        ...detectedWorkspace,
        toolchain: mergeToolchain(rootToolchain, detectedWorkspace.toolchain),
      }
    : detectedWorkspace;

  return mergeProfileOverrides({
    detected,
    projectDesign: detectedWorkspace.design ?? rootDesign,
    workspaceConfig,
  });
}
