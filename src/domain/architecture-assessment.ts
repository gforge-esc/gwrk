/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { z } from "zod";

const text = z.string().trim().min(1);
const localPath = text.refine(
  (value) => !value.startsWith("/") && !value.split(/[\\/]/).includes(".."),
  "Repository-relative path required",
);
export const AssessmentSchema = z.object({
  overview: text,
  inspected: z.array(localPath).min(1),
  limitations: z.array(text),
  findings: z.array(
    z.object({
      id: text,
      rule: text,
      description: text,
      evidence: z
        .array(
          z.object({
            file: localPath,
            line: z.number().int().positive(),
            observation: text,
          }),
        )
        .min(1),
    }),
  ),
  features: z.array(
    z.object({
      id: text.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      title: text,
      summary: text,
      dependsOn: z.array(text),
      findingIds: z.array(text).min(1),
      changes: z.array(text).min(1),
      acceptance: z.array(text).min(1),
    }),
  ),
  reconciliation: z.array(
    z.object({
      gap: text,
      status: z.enum(["confirmed", "resolved", "revised", "unassessed"]),
      findingIds: z.array(text),
      explanation: text,
    }),
  ),
});
export type ArchitectureAssessment = z.infer<typeof AssessmentSchema>;
export function validateAssessment(raw: unknown): ArchitectureAssessment {
  const value = AssessmentSchema.parse(raw);
  const findings = new Set(value.findings.map((finding) => finding.id));
  if (findings.size !== value.findings.length)
    throw new Error("Duplicate finding identifier");
  const features = new Set<string>();
  const covered = new Set<string>();
  for (const feature of value.features) {
    if (features.has(feature.id))
      throw new Error("Duplicate feature identifier");
    for (const dependency of feature.dependsOn)
      if (!features.has(dependency))
        throw new Error(`Invalid or unordered dependency: ${dependency}`);
    for (const finding of feature.findingIds) {
      if (!findings.has(finding))
        throw new Error(`Unknown finding: ${finding}`);
      covered.add(finding);
    }
    features.add(feature.id);
  }
  for (const finding of findings)
    if (!covered.has(finding))
      throw new Error(`Finding not covered by a feature: ${finding}`);
  for (const entry of value.reconciliation)
    for (const id of entry.findingIds)
      if (!findings.has(id))
        throw new Error(`Unknown reconciled finding: ${id}`);
  return value;
}
export function renderAssessment(value: ArchitectureAssessment): string {
  return `# Architecture assessment\n\n${value.overview}\n\nBlocked: none for this assessment. Feature proposals require project adoption.\n\n## Scope\n\n${value.inspected.map((file) => `- ${file}`).join("\n")}\n\n## Findings\n\n${value.findings.map((finding) => `### ${finding.id} ${finding.rule}\n\n${finding.description}\n\n${finding.evidence.map((evidence) => `- ${evidence.file} at line ${evidence.line}. ${evidence.observation}`).join("\n")}`).join("\n\n")}\n\n## Feature sequence\n\n${value.features.map((feature, i) => `${i + 1}. [${feature.title}](specs/${String(i + 1).padStart(2, "0")}-${feature.id}/spec.md)`).join("\n")}\n\n## Prior gap reconciliation\n\n${value.reconciliation.map((entry) => `### ${entry.gap}\n\nStatus: ${entry.status}.\n\n${entry.explanation}\n\nFindings: ${entry.findingIds.join(", ") || "None"}.`).join("\n\n")}\n\n## Limits\n\n${value.limitations.map((limit) => `- ${limit}`).join("\n")}\n`;
}
export function renderFeature(
  feature: ArchitectureAssessment["features"][number],
): string {
  return `# ${feature.title}\n\n${feature.summary}\n\nBlocked: ${feature.dependsOn.length ? feature.dependsOn.join(", ") : "none"}. This is a proposed feature specification.\n\n## Finding coverage\n\n${feature.findingIds.map((id) => `- ${id}`).join("\n")}\n\n## Dependencies\n\n${feature.dependsOn.map((id) => `- ${id}`).join("\n") || "None."}\n\n## Required changes\n\n${feature.changes.map((change) => `- ${change}`).join("\n")}\n\n## Acceptance criteria\n\n${feature.acceptance.map((criterion, i) => `${i + 1}. ${criterion}`).join("\n")}\n\n## Validation\n\nProve the relevant failing tests before implementation. Preserve existing behavior during structural moves. Run boundary and behavior checks after each migration step.\n`;
}
