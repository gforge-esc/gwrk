import type { Command } from "commander";

/**
 * Command metadata for enriched help text.
 * Implements DM-003.
 */
interface CommandMeta {
  type: "query" | "generator" | "verifier" | "mutator";
  exitCodes: Record<number, string>;
  supportsJson: boolean;
  mutations?: string[];
  outputs?: string;
}

/**
 * Applies CommandMeta to a commander Command instance to enrich --help.
 * Implements FR-008.
 */
function applyMeta(cmd: Command, meta: CommandMeta): void {
  const exitCodesStr = Object.entries(meta.exitCodes)
    .map(([code, desc]) => `  ${code}: ${desc}`)
    .join("\n");

  const mutationsStr = meta.mutations?.length
    ? `Mutates: ${meta.mutations.join(", ")}\n`
    : "";

  const outputsStr = meta.outputs ? `Outputs: ${meta.outputs}\n` : "";

  const formatStr = meta.supportsJson
    ? "Format: use gwrk --format json for structured output\n"
    : "";

  cmd.addHelpText(
    "after",
    `
Type: ${meta.type}
${formatStr}${mutationsStr}${outputsStr}Exit codes:
${exitCodesStr}
`,
  );
}
