/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  type ProjectDesign,
  designRules,
  lookupFrameworkGuidance,
  lookupLanguageGuidance,
  normalizeArchitecture,
} from "./architecture-context.js";
import type { ProjectProfile } from "./types.js";

export type EnforcementScope = "define" | "implementation" | "review" | "all";

export type DesignPrinciple = "functional-core" | "clean-code" | "tdd";

export type PolicySourceLayer =
  | "builtin"
  | "global"
  | "project-entry"
  | "project-local";

export interface EnforcementSkillSelectors {
  scope?: EnforcementScope;
  language?: string;
  framework?: string;
  architectures?: string[];
  principles?: DesignPrinciple[];
  projectScope?: "any" | "gwrk";
}

export interface PolicyCandidate {
  name: string;
  source: PolicySourceLayer;
  manifest: EnforcementSkillSelectors & {
    name: string;
    description: string;
    version: string;
    disabled?: boolean;
  };
  content?: string;
}

export type PolicyGapKind =
  | "missing-language-binding"
  | "missing-framework-binding"
  | "incompatible-framework-policy"
  | "unbundled-architecture";

export interface PolicyGap {
  kind: PolicyGapKind;
  subject: string;
  message: string;
}

export interface CandidateEvaluation {
  included: boolean;
  reason:
    | "selected"
    | "project-local-override"
    | "legacy-global-unscoped"
    | "shadowed-by-override"
    | "scope-mismatch"
    | "project-scope-mismatch"
    | "language-mismatch"
    | "framework-mismatch"
    | "architecture-mismatch"
    | "principle-mismatch";
}

export interface EffectivePolicy {
  scope: EnforcementScope;
  design?: ProjectDesign;
  checksStatus: "inactive" | "configured";
  architectureRules: string[];
  languageGuidance?: string;
  frameworkGuidance?: string;
  selectedSkills: PolicyCandidate[];
  excludedSkills: Array<{
    name: string;
    source: PolicySourceLayer;
    reason: CandidateEvaluation["reason"];
  }>;
  gaps: PolicyGap[];
}

export interface ComposePolicyInput {
  profile?: ProjectProfile;
  scope?: EnforcementScope;
  candidates: readonly PolicyCandidate[];
  checksConfigured?: boolean;
}

export { lookupFrameworkGuidance, lookupLanguageGuidance };

const LAYER_PRECEDENCE: Record<PolicySourceLayer, number> = {
  "project-local": 1,
  "project-entry": 2,
  global: 3,
  builtin: 4,
};

const RENDER_POSITION: Record<PolicySourceLayer, number> = {
  builtin: 1,
  global: 2,
  "project-entry": 3,
  "project-local": 4,
};

function profileLanguages(profile?: ProjectProfile): string[] {
  const values = [
    profile?.stack?.language,
    ...(profile?.stack?.languages ?? []),
  ];
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const language = value?.trim();
    const key = language?.toLowerCase();
    if (
      !language ||
      !key ||
      key === "none" ||
      key === "unspecified" ||
      seen.has(key)
    )
      return [];
    seen.add(key);
    return [language];
  });
}

function frameworkMatches(
  candidate: PolicyCandidate,
  framework: string,
): boolean {
  const normalize = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return Boolean(
    candidate.manifest.framework &&
      normalize(candidate.manifest.framework) === normalize(framework),
  );
}

export function evaluateEnforcementCandidate(
  candidate: PolicyCandidate,
  profile: ProjectProfile | undefined,
  scope: EnforcementScope,
): CandidateEvaluation {
  const manifest = candidate.manifest;

  // 1. Scope check
  const manifestScope = manifest.scope ?? "all";
  if (scope !== "all" && manifestScope !== "all" && manifestScope !== scope) {
    return { included: false, reason: "scope-mismatch" };
  }

  // 2. Project scope check (verified gwrk repository identity)
  if (manifest.projectScope === "gwrk" && profile?._isGwrk !== true) {
    return { included: false, reason: "project-scope-mismatch" };
  }

  // 3. Language check
  if (manifest.language) {
    const candidateLang = manifest.language.toLowerCase().trim();
    const profileLangs = profileLanguages(profile).map((language) =>
      language.toLowerCase(),
    );
    if (!profileLangs.includes(candidateLang)) {
      return { included: false, reason: "language-mismatch" };
    }
  }

  // 4. Framework check
  if (manifest.framework) {
    const candidateFw = manifest.framework
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    const profileFw = profile?.stack?.framework
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    if (!profileFw || profileFw !== candidateFw) {
      return { included: false, reason: "framework-mismatch" };
    }
  }

  // 5. Architecture check
  if (manifest.architectures && manifest.architectures.length > 0) {
    if (!profile?.design?.architecture) {
      return { included: false, reason: "architecture-mismatch" };
    }
    const profileArch = normalizeArchitecture(profile.design.architecture);
    const candidateArchs = manifest.architectures.map(normalizeArchitecture);
    if (!candidateArchs.includes(profileArch)) {
      return { included: false, reason: "architecture-mismatch" };
    }
  }

  // 6. Principles check
  if (manifest.principles && manifest.principles.length > 0) {
    if (!profile?.design?.principles) {
      return { included: false, reason: "principle-mismatch" };
    }
    const profilePrinciples = new Set(profile.design.principles);
    for (const p of manifest.principles) {
      if (!profilePrinciples.has(p)) {
        return { included: false, reason: "principle-mismatch" };
      }
    }
  }

  // Candidate is compatible. Determine inclusion reason based on source layer and selectors.
  if (candidate.source === "project-local") {
    return { included: true, reason: "project-local-override" };
  }

  if (candidate.source === "global") {
    const hasSelectors =
      Boolean(manifest.language) ||
      Boolean(manifest.framework) ||
      Boolean(manifest.architectures && manifest.architectures.length > 0) ||
      Boolean(manifest.principles && manifest.principles.length > 0) ||
      Boolean(manifest.projectScope);
    if (!hasSelectors) {
      return { included: true, reason: "legacy-global-unscoped" };
    }
  }

  return { included: true, reason: "selected" };
}

function resolveCandidates(input: ComposePolicyInput, scope: EnforcementScope) {
  const selectedSkills: PolicyCandidate[] = [];
  const excludedSkills: EffectivePolicy["excludedSkills"] = [];

  const incompatibleSkills: PolicyCandidate[] = [];
  const seenNames = new Set<string>();
  const uniqueNames: string[] = [];
  for (const c of input.candidates) {
    if (!seenNames.has(c.name)) {
      seenNames.add(c.name);
      uniqueNames.push(c.name);
    }
  }

  for (const name of uniqueNames) {
    const group = input.candidates.filter((c) => c.name === name);
    const sortedGroup = [...group].sort(
      (a, b) => LAYER_PRECEDENCE[a.source] - LAYER_PRECEDENCE[b.source],
    );

    const incompatibleGroup: PolicyCandidate[] = [];
    let selectedForSkill: PolicyCandidate | undefined;
    let suppressedByDisabled = false;

    for (const candidate of sortedGroup) {
      if (selectedForSkill || suppressedByDisabled) {
        excludedSkills.push({
          name: candidate.name,
          source: candidate.source,
          reason: "shadowed-by-override",
        });
        continue;
      }

      const evaluation = evaluateEnforcementCandidate(
        candidate,
        input.profile,
        scope,
      );

      if (!evaluation.included) {
        if (
          !candidate.manifest.disabled &&
          [
            "language-mismatch",
            "architecture-mismatch",
            "principle-mismatch",
          ].includes(evaluation.reason)
        ) {
          incompatibleGroup.push(candidate);
        }
        excludedSkills.push({
          name: candidate.name,
          source: candidate.source,
          reason: evaluation.reason,
        });
        continue;
      }

      if (candidate.manifest.disabled) {
        suppressedByDisabled = true;
        incompatibleGroup.length = 0;
        continue;
      }

      selectedForSkill = candidate;
      selectedSkills.push(candidate);
    }
    incompatibleSkills.push(...incompatibleGroup);
  }

  selectedSkills.sort((a, b) => {
    const diff = RENDER_POSITION[a.source] - RENDER_POSITION[b.source];
    if (diff !== 0) return diff;
    return input.candidates.indexOf(a) - input.candidates.indexOf(b);
  });

  return { selectedSkills, excludedSkills, incompatibleSkills };
}

export function composeEffectivePolicy(
  input: ComposePolicyInput,
): EffectivePolicy {
  const scope: EnforcementScope = input.scope ?? "all";
  const resolved = resolveCandidates(input, scope);
  const { selectedSkills, excludedSkills } = resolved;
  const coverage = scope === "all" ? resolved : resolveCandidates(input, "all");
  const languages = profileLanguages(input.profile);
  const design = input.profile?.design
    ? {
        ...input.profile.design,
        architecture: normalizeArchitecture(input.profile.design.architecture),
      }
    : undefined;
  const gaps: PolicyGap[] = [];

  for (const language of languages) {
    const covered = coverage.selectedSkills.some(
      (candidate) =>
        candidate.manifest.language?.trim().toLowerCase() ===
        language.toLowerCase(),
    );
    if (!lookupLanguageGuidance(language) && !covered) {
      gaps.push({
        kind: "missing-language-binding",
        subject: language,
        message: `No bundled language binding or selected policy for ${language}. Assess language-specific boundaries explicitly.`,
      });
    }
  }

  // Framework gap
  const framework = input.profile?.stack?.framework;
  if (
    framework &&
    framework.toLowerCase() !== "unspecified" &&
    framework.toLowerCase() !== "none"
  ) {
    const covered = coverage.selectedSkills.some((candidate) =>
      frameworkMatches(candidate, framework),
    );
    if (!covered) {
      if (
        coverage.incompatibleSkills.some((candidate) =>
          frameworkMatches(candidate, framework),
        )
      ) {
        gaps.push({
          kind: "incompatible-framework-policy",
          subject: framework,
          message: `No compatible policy found for framework ${framework}.`,
        });
      } else if (!lookupFrameworkGuidance(framework)) {
        gaps.push({
          kind: "missing-framework-binding",
          subject: framework,
          message: `No bundled framework binding or policy for ${framework}.`,
        });
      }
    }
  }

  // Architecture gap
  const architecture = design?.architecture;
  if (architecture) {
    const normArch = architecture.toLowerCase().trim();
    const bundled = ["hexagonal-functional", "layered", "clean"];
    if (!bundled.includes(normArch)) {
      gaps.push({
        kind: "unbundled-architecture",
        subject: architecture,
        message: `Architecture ${architecture} is not a bundled architecture template.`,
      });
    }
  }

  return {
    scope,
    design,
    checksStatus: input.checksConfigured ? "configured" : "inactive",
    architectureRules: design ? designRules(design) : [],
    languageGuidance: lookupLanguageGuidance(languages[0]),
    frameworkGuidance: lookupFrameworkGuidance(input.profile?.stack?.framework),
    selectedSkills,
    excludedSkills,
    gaps,
  };
}
