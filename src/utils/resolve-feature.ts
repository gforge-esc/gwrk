import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Resolve a feature identifier to its full directory name.
 *
 * Supports:
 *   - Full name: "003-slack" → "003-slack"
 *   - Numeric prefix: "003" → "003-slack"
 *   - Ambiguous prefix: "00" → throws (matches multiple)
 *   - Unknown: "999" → throws
 */
export function resolveFeature(
  featureInput: string,
  projectRoot: string = process.cwd(),
): string {
  const specsDir = path.join(projectRoot, "specs");
  if (!fs.existsSync(specsDir)) {
    throw new Error(`Specs directory not found: ${specsDir}`);
  }

  // Exact match first
  const exactPath = path.join(specsDir, featureInput);
  if (fs.existsSync(exactPath) && fs.statSync(exactPath).isDirectory()) {
    return featureInput;
  }

  // Prefix match: list all directories in specs/ and match by prefix
  const entries = fs.readdirSync(specsDir).filter((entry) => {
    const fullPath = path.join(specsDir, entry);
    return fs.statSync(fullPath).isDirectory();
  });

  // Match: "003" → "003-slack", "00" → ["001-...", "002-...", "003-..."]
  const isNumericInput = /^\d+$/.test(featureInput);
  const matches = entries.filter((entry) => {
    if (entry.startsWith(`${featureInput}-`) || entry === featureInput) {
      return true;
    }
    // For pure numeric input, also match against the feature's numeric prefix
    if (isNumericInput) {
      const entryNumeric = entry.match(/^(\d+)/);
      if (entryNumeric && entryNumeric[1].startsWith(featureInput)) {
        return true;
      }
    }
    return false;
  });

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length > 1) {
    throw new Error(
      `Ambiguous feature prefix "${featureInput}" matches: ${matches.join(", ")}. Be more specific.`,
    );
  }

  // No match — build helpful error
  const available = entries.map((e) => `  - ${e}`).join("\n");
  throw new Error(
    `Feature not found: "${featureInput}"\n\nAvailable features:\n${available}`,
  );
}
