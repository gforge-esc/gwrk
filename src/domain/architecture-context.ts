/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { z } from "zod";

export const DesignSchema = z.object({
  architecture: z.string().min(1),
  principles: z
    .array(z.enum(["functional-core", "clean-code", "tdd"]))
    .default([]),
  templateVersion: z.literal("1.0.0").default("1.0.0"),
});
export type ProjectDesign = z.infer<typeof DesignSchema>;
export interface ContextInput {
  projectName: string;
  design: ProjectDesign;
  language?: string;
  framework?: string;
  decisionsDir: string;
}

export function resolveDesign(input: {
  architecture: string;
  principles?: string[];
}): ProjectDesign {
  let architecture = input.architecture
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
  if (["hexagonal", "hexagonal-with-functional-core"].includes(architecture))
    architecture = "hexagonal-functional";
  const principles = [...new Set(input.principles ?? ["clean-code", "tdd"])];
  if (
    architecture === "hexagonal-functional" &&
    !principles.includes("functional-core")
  )
    principles.unshift("functional-core");
  return DesignSchema.parse({ architecture, principles });
}

const LANGUAGE_GUIDANCE: Record<string, string> = {
  typescript:
    "Use interfaces for ports. Inject effectful services. Keep framework types outside domain signatures.",
  javascript:
    "Use explicit object contracts for ports. Inject effects through arguments. Test runtime boundary validation.",
  python:
    "Use typing.Protocol for ports. Pass configuration as values. Keep model loading and framework imports in adapters.",
  go: "Define small consumer-owned interfaces. Keep domain packages independent of transport and persistence packages.",
  rust: "Use traits for ports and explicit Result values. Keep infrastructure crates outside the domain dependency graph.",
};
const FRAMEWORK_GUIDANCE: Record<string, string> = {
  fastapi:
    "FastAPI routers and Depends wiring belong in adapters or composition. Domain types must not depend on FastAPI or transport schemas.",
  django:
    "Keep Django ORM models and transactions in persistence adapters. Domain policy uses plain values and ports.",
  fastify:
    "Fastify routes and plugin registration belong in transport adapters. Composition supplies domain services.",
  express:
    "Express middleware and request objects stay in transport adapters. Domain operations accept plain inputs.",
  react:
    "Keep rendering and hooks outside domain transformations. Pass external effects through explicit interfaces.",
  nextjs:
    "Keep Next.js routes and server actions outside domain policy. Inject persistence and network adapters.",
  gin: "Gin contexts stay in HTTP adapters. Domain services accept typed values and consumer-owned interfaces.",
  chi: "Chi routing and HTTP handlers stay outside domain policy. Inject ports at composition.",
  axum: "Axum extractors and State belong in transport adapters. Domain services use plain types and traits.",
  clap: "Clap parsing belongs at the CLI boundary. Domain policy accepts typed inputs without command-line dependencies.",
};
export function designRules(design: ProjectDesign): string[] {
  const rules: string[] = [];
  if (design.architecture === "hexagonal-functional")
    rules.push(
      "Domain policy MUST depend inward. Ports declare boundaries. Adapters implement effects. Composition wires dependencies.",
      "Domain code MUST NOT access external state. Isolate filesystem and network effects in adapters. Pass environment and clock values as inputs.",
    );
  else if (design.architecture === "layered")
    rules.push(
      "Dependencies MUST follow the project's declared layer direction. Record concrete layer bindings before enforcing import rules.",
    );
  else if (design.architecture === "clean")
    rules.push(
      "Business rules MUST remain independent of frameworks and infrastructure. Dependencies point toward domain policy.",
    );
  else
    rules.push(
      "The project MUST define concrete architecture constraints in its decision corpus before claiming architectural conformance.",
    );
  if (design.principles.includes("functional-core"))
    rules.push(
      "Core operations MUST return explicit results without hidden mutable state. Equal inputs produce equal outputs. Test domain laws.",
    );
  if (design.principles.includes("clean-code"))
    rules.push(
      "Functions MUST separate policy from effects. Use one domain term per concept. Identify duplicate work and explicit error paths.",
    );
  if (design.principles.includes("tdd"))
    rules.push(
      "Implementation MUST follow observed RED tests with GREEN execution evidence. Passing checks do not erase uncovered design defects.",
    );
  return rules;
}
export function contextMarkdown(
  input: ContextInput,
  decisions: string[],
): string {
  const language = input.language?.toLowerCase() ?? "";
  const framework =
    input.framework?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
  return `# Project architecture target\n\nTarget context guides future work. Code conformance remains unassessed by initialization. Blocked: none.\n\n## Selection\n\n- Project: ${input.projectName}\n- Architecture: ${input.design.architecture}\n- Language: ${input.language ?? "unspecified"}\n- Framework: ${input.framework ?? "unspecified"}\n- Template version: ${input.design.templateVersion}\n- Architecture checks: activation unchanged by initialization\n\n## Rules\n\n${designRules(
    input.design,
  )
    .map((rule) => `- ${rule}`)
    .join(
      "\n",
    )}\n\n## Language guidance\n\n${LANGUAGE_GUIDANCE[language] ?? "No bundled language binding. Assess language-specific boundaries explicitly."}\n\n## Framework guidance\n\n${framework ? (FRAMEWORK_GUIDANCE[framework] ?? "No bundled framework binding. Framework compatibility remains unassessed.") : "No framework selected."}\n\n## Project decisions\n\n${decisions.map((file) => `- ${file}`).join("\n")}\n\nRead the complete decision corpus and preserve existing Decided constraints. Generated target records remain Proposed until human ratification. Resolve conflicts before implementation.\n\n## Later assessment\n\nRun \`gwrk assess\` to assess the existing code against this target. The portable gwrk-assess skill uses the same method. Assessment proposes feature specs and never certifies the entire codebase.\n`;
}

export function decisionMarkdown(
  input: ContextInput,
  number: string,
  date: string,
): string {
  return `# ADR-${number}: Desired project architecture\n\n> **Status:** Proposed\n> **Date:** ${date}\n> **Decision:** Adopt ${input.design.architecture} as the target for ${input.projectName}.\n> **Constraint:** Future implementation MUST follow the declared target rules after project adoption.\n> **Depends on:**\n> **Supersedes:**\n> **Author:** Project owner · **Decision Scope:** Project architecture target\n\n## 1. Context\n\nThe owner selected a target during deterministic initialization. Existing code conformance remains unassessed. Existing Decided records retain authority.\n\n## 2. Decision\n\n${designRules(
    input.design,
  )
    .map((rule, i) => `### 2.${i + 1} Constraint\n\n${rule}`)
    .join(
      "\n\n",
    )}\n\n## 3. Decision Record\n\n| Field | Value |\n|---|---|\n| Position | ${input.design.architecture} |\n| Confidence | Unassessed |\n| Reversibility | Amend through project decisions |\n| Risk | Migration scope unassessed |\n\n## 4. Alternatives Rejected\n\nNo alternatives were evaluated during initialization. Human adoption requires review of existing decisions.\n\n## 5. Impact on Existing Code\n\nInitialization changes context only. Later assessment identifies code changes and executable checks.\n\n## 6. Consequences\n\nThe target guides later planning and implementation. It does not establish present compliance.\n\n## 7. References\n\n- .gwrk/architecture.md\n- Template version ${input.design.templateVersion}\n\n## Amendments\n\n| Amending | At | Summary |\n|---|---|---|\n`;
}
