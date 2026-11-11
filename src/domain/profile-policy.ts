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
type Stack = NonNullable<ProjectProfile["stack"]>;

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

export function resolveProfileStack(
  detectedStack: ProjectProfile["stack"],
  localStack: ProjectProfile["stack"],
  entryStack: ProjectProfile["stack"],
  detectedStacks: readonly Stack[] = [],
): ProjectProfile["stack"] {
  if (!detectedStack && !localStack && !entryStack) return undefined;

  const selectedLanguage =
    entryStack?.language ||
    entryStack?.languages?.[0] ||
    localStack?.language ||
    localStack?.languages?.[0];
  const detectedFamily = languageFamily(profileLanguage(detectedStack));
  const workspaceFamily = languageFamily(
    selectedLanguage?.toLowerCase() ?? profileLanguage(detectedStack),
  );
  const localFamily = languageFamily(profileLanguage(localStack));
  const {
    framework: localFramework,
    buildSystem: localBuildSystem,
    ...localFields
  } = localStack ?? {};
  const compatibleLocal = !localFamily || localFamily === workspaceFamily;
  const selectedStack = detectedStacks.find(
    (stack) => languageFamily(profileLanguage(stack)) === workspaceFamily,
  );

  const { framework, buildSystem, ...sharedStack } = detectedStack ?? {};
  const compatibleFamily =
    detectedFamily === undefined || detectedFamily === workspaceFamily;
  const workspaceFramework =
    selectedStack?.framework ?? (compatibleFamily ? framework : undefined);
  const workspaceBuildSystem =
    selectedStack?.buildSystem ?? (compatibleFamily ? buildSystem : undefined);

  return {
    ...sharedStack,
    ...(workspaceFramework !== undefined && { framework: workspaceFramework }),
    ...(workspaceBuildSystem !== undefined && {
      buildSystem: workspaceBuildSystem,
    }),
    ...localFields,
    ...(compatibleLocal &&
      localFramework !== undefined && { framework: localFramework }),
    ...(compatibleLocal &&
      localBuildSystem !== undefined && { buildSystem: localBuildSystem }),
    ...entryStack,
    ...(selectedLanguage && { language: selectedLanguage }),
  };
}

function compatibleToolchain(
  toolchain: ProjectProfile["toolchain"],
  sourceStack: ProjectProfile["stack"],
  workspaceStack: ProjectProfile["stack"],
  source: "root" | "detected" | "local",
): ProjectProfile["toolchain"] {
  if (!toolchain) return undefined;

  const sourceBuildSystem = sourceStack?.buildSystem?.toLowerCase();
  const workspaceBuildSystem = workspaceStack?.buildSystem?.toLowerCase();
  const buildSystemsMatch =
    !sourceBuildSystem ||
    !workspaceBuildSystem ||
    sourceBuildSystem === workspaceBuildSystem;
  const workspaceLanguage = profileLanguage(workspaceStack);
  const sourceLanguage = profileLanguage(sourceStack);
  const workspaceFamily = languageFamily(workspaceLanguage);
  const configuredSourceFamily = languageFamily(sourceLanguage);
  const extensionsMatch =
    !sourceLanguage ||
    !workspaceLanguage ||
    sourceLanguage === workspaceLanguage;
  const isLocal = source === "local";

  if (!workspaceLanguage) {
    if (buildSystemsMatch) return toolchain;
    const { build, testCommand: _command, ...compatible } = toolchain;
    if (isLocal && build === null) return { ...compatible, build };
    return Object.keys(compatible).length ? compatible : undefined;
  }

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
    configuredSourceFamily ??
    (test ? toolLanguages[test] : undefined) ??
    (primary ? toolLanguages[primary] : undefined) ??
    (formatter ? toolLanguages[formatter] : undefined);
  const differentFamily =
    sourceFamily !== undefined && sourceFamily !== workspaceFamily;
  const buildFits = !differentFamily && buildSystemsMatch;
  const runnerFits =
    (!differentFamily ||
      (source !== "root" && test != null) ||
      (isLocal && test === null)) &&
    (!test || toolLanguages[test] === workspaceFamily);
  const extensionsFit = !differentFamily && extensionsMatch;
  const compatible: Toolchain = {
    ...(primary && toolLanguages[primary] === workspaceFamily && { primary }),
    ...(formatter &&
      toolLanguages[formatter] === workspaceFamily && { formatter }),
    ...(runnerFits && test !== undefined && { test }),
    ...(runnerFits &&
      buildFits &&
      testCommand !== undefined && { testCommand }),
    ...((buildFits || (isLocal && build === null)) &&
      build !== undefined && { build }),
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
    matchedLocalProject?: WorkspaceProfileConfig;
    detectedStacks?: readonly Stack[];
    detectedToolchains?: Readonly<Record<string, Toolchain>>;
  },
): ProjectProfile {
  const workspaces = rootConfig?.workspaces ?? {};
  const bestMatch = matchWorkspacePath(
    workspaceRelPath,
    Object.keys(workspaces),
  );
  const workspaceConfig = bestMatch ? workspaces[bestMatch] : undefined;
  const localProject = options?.localProject;
  const matchedLocalProject = options?.matchedLocalProject;
  const rootDesign = rootConfig?.project?.design;
  const projectDesign =
    localProject?.design ??
    matchedLocalProject?.design ??
    detectedWorkspace.design ??
    rootDesign;
  if (!projectDesign && !workspaceConfig?.design) {
    if (options?.requireDesign || !workspaceConfig) return detectedWorkspace;
    return mergeProfileOverrides({
      detected: detectedWorkspace,
      workspaceConfig,
    });
  }

  const { stack: entryStack, ...workspaceOverrides } = workspaceConfig ?? {};
  const localStack = resolveProfileStack(
    matchedLocalProject?.stack,
    localProject?.stack,
    undefined,
  );
  const workspaceStack = resolveProfileStack(
    detectedWorkspace.stack,
    localStack,
    entryStack,
    options?.detectedStacks,
  );
  const rootToolchain = compatibleToolchain(
    rootConfig?.project?.toolchain,
    rootConfig?.project?.stack,
    workspaceStack,
    "root",
  );
  const {
    stack: rawStack,
    toolchain: rawToolchain,
    ...detected
  } = detectedWorkspace;
  const workspaceFamily = languageFamily(profileLanguage(workspaceStack));
  const detectedToolchain = mergeToolchain(
    compatibleToolchain(rawToolchain, rawStack, workspaceStack, "detected"),
    workspaceFamily
      ? options?.detectedToolchains?.[workspaceFamily]
      : undefined,
  );
  const localSourceStack = resolveProfileStack(
    rawStack,
    localStack,
    undefined,
    options?.detectedStacks,
  );
  const matchedToolchain = compatibleToolchain(
    matchedLocalProject?.toolchain,
    resolveProfileStack(
      rawStack,
      matchedLocalProject?.stack,
      undefined,
      options?.detectedStacks,
    ),
    workspaceStack,
    "local",
  );
  const requestedToolchain = compatibleToolchain(
    localProject?.toolchain,
    localSourceStack,
    workspaceStack,
    "local",
  );
  const localToolchain = requestedToolchain
    ? mergeToolchain(matchedToolchain, requestedToolchain)
    : matchedToolchain;

  return mergeProfileOverrides({
    detected:
      rootToolchain || Object.keys(detectedToolchain).length
        ? {
            ...detected,
            toolchain: mergeToolchain(rootToolchain, detectedToolchain),
          }
        : detected,
    projectDesign,
    projectType: localProject?.type ?? matchedLocalProject?.type,
    projectStack: workspaceStack,
    projectToolchain: localToolchain,
    workspaceConfig: workspaceOverrides,
  });
}
