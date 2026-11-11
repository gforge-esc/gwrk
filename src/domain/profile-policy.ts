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

type Toolchain = NonNullable<ProjectProfile["toolchain"]>;

const toolLanguages = {
  vitest: "javascript",
  jest: "javascript",
  "node-test": "javascript",
  pytest: "python",
  "cargo-test": "rust",
  "go-test": "go",
  biome: "javascript",
  eslint: "javascript",
  prettier: "javascript",
  ruff: "python",
  black: "python",
  "golangci-lint": "go",
  gofmt: "go",
  clippy: "rust",
  cargo: "rust",
  rustfmt: "rust",
} satisfies Record<
  NonNullable<Toolchain["test" | "primary" | "formatter"]>,
  string
>;

function profileLanguage(stack: ProjectProfile["stack"]): string | undefined {
  return stack?.language?.toLowerCase() || stack?.languages?.[0]?.toLowerCase();
}

function languageFamily(language: string | undefined): string | undefined {
  return language === "typescript" ? "javascript" : language;
}

function compatibleToolchain(
  toolchain: ProjectProfile["toolchain"],
  sourceStack: ProjectProfile["stack"],
  workspaceStack: ProjectProfile["stack"],
  source: "root" | "detected",
): ProjectProfile["toolchain"] {
  const workspaceLanguage = profileLanguage(workspaceStack);
  if (!toolchain || !workspaceLanguage) return toolchain;

  const sourceLanguage = profileLanguage(sourceStack);
  const workspaceFamily = languageFamily(workspaceLanguage);
  const {
    primary,
    formatter,
    test,
    testCommand,
    build,
    testExtension,
    sourceExtension,
  } = toolchain;
  const sourceFamily =
    languageFamily(sourceLanguage) ??
    (test ? toolLanguages[test] : undefined) ??
    (primary ? toolLanguages[primary] : undefined) ??
    (formatter ? toolLanguages[formatter] : undefined);
  const differentFamily =
    sourceFamily !== undefined && sourceFamily !== workspaceFamily;
  const sourceBuildSystem = sourceStack?.buildSystem?.toLowerCase();
  const workspaceBuildSystem = workspaceStack?.buildSystem?.toLowerCase();
  const buildFits =
    !differentFamily &&
    (!sourceBuildSystem ||
      !workspaceBuildSystem ||
      sourceBuildSystem === workspaceBuildSystem);
  const runnerFits =
    (!differentFamily || (source === "detected" && test != null)) &&
    (!test || toolLanguages[test] === workspaceFamily);
  const extensionsFit =
    !differentFamily &&
    (!sourceLanguage || sourceLanguage === workspaceLanguage);
  const compatible: Toolchain = {
    ...(primary && toolLanguages[primary] === workspaceFamily && { primary }),
    ...(formatter &&
      toolLanguages[formatter] === workspaceFamily && { formatter }),
    ...(runnerFits && test !== undefined && { test }),
    ...(runnerFits &&
      buildFits &&
      testCommand !== undefined && { testCommand }),
    ...(buildFits && build !== undefined && { build }),
    ...(extensionsFit && testExtension !== undefined && { testExtension }),
    ...(extensionsFit && sourceExtension !== undefined && { sourceExtension }),
  };
  return Object.keys(compatible).length ? compatible : undefined;
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

export function matchWorkspacePath(
  relativePath: string,
  workspacePaths: readonly string[],
): string | undefined {
  let bestMatch: string | undefined;
  for (const workspacePath of workspacePaths) {
    if (
      workspacePath.length > (bestMatch?.length ?? 0) &&
      (relativePath === workspacePath ||
        relativePath.startsWith(`${workspacePath}/`))
    ) {
      bestMatch = workspacePath;
    }
  }
  return bestMatch;
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
  options?: {
    requireDesign?: boolean;
    localProject?: WorkspaceProfileConfig;
  },
): ProjectProfile {
  const workspaces = rootConfig?.workspaces ?? {};
  const bestMatch = matchWorkspacePath(
    workspaceRelPath,
    Object.keys(workspaces),
  );
  const workspaceConfig = bestMatch ? workspaces[bestMatch] : undefined;
  const localProject = options?.localProject;
  const rootDesign = rootConfig?.project?.design;
  const projectDesign =
    localProject?.design ?? detectedWorkspace.design ?? rootDesign;
  if (!projectDesign && !workspaceConfig?.design) {
    if (options?.requireDesign || !workspaceConfig) return detectedWorkspace;
    return mergeProfileOverrides({
      detected: detectedWorkspace,
      workspaceConfig,
    });
  }

  const workspaceStack = {
    ...detectedWorkspace.stack,
    ...localProject?.stack,
    ...workspaceConfig?.stack,
  };
  const rootToolchain = compatibleToolchain(
    rootConfig?.project?.toolchain,
    rootConfig?.project?.stack,
    workspaceStack,
    "root",
  );
  const { toolchain: rawToolchain, ...detected } = detectedWorkspace;
  const detectedToolchain = compatibleToolchain(
    rawToolchain,
    detectedWorkspace.stack,
    workspaceStack,
    "detected",
  );

  return mergeProfileOverrides({
    detected:
      rootToolchain || detectedToolchain
        ? {
            ...detected,
            toolchain: mergeToolchain(rootToolchain, detectedToolchain),
          }
        : detected,
    projectDesign,
    projectType: localProject?.type,
    projectStack: localProject?.stack,
    projectToolchain: localProject?.toolchain,
    workspaceConfig,
  });
}
