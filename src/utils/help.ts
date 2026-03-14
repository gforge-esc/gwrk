import type { Command } from "commander";

/**
 * Command metadata for enriched help text.
 * Implements DM-003.
 */
export interface CommandMeta {
  type: "query" | "generator" | "verifier" | "mutator";
  exitCodes: Record<number, string>;
  formats: ("human" | "json")[];
  mutations?: string[];
  outputs?: string;
}

/**
 * Applies CommandMeta to a commander Command instance to enrich --help.
 * Implements FR-008.
 */
export function applyMeta(cmd: Command, meta: CommandMeta): void {
  const exitCodesStr = Object.entries(meta.exitCodes)
    .map(([code, desc]) => `  ${code}: ${desc}`)
    .join("\n");

  const mutationsStr = meta.mutations?.length
    ? `Mutates: ${meta.mutations.join(", ")}\n`
    : "";

  const outputsStr = meta.outputs ? `Outputs: ${meta.outputs}\n` : "";

  cmd.addHelpText(
    "after",
    `
Type: ${meta.type}
Formats: ${meta.formats.join(", ")}
${mutationsStr}${outputsStr}Exit codes:
${exitCodesStr}
`,
  );
}
