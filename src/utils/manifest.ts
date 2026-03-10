import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

export const ExecutionManifestSchema = z.object({
  runId: z.string(),
  feature: z.string(),
  phase: z.string(),
  command: z.string(),
  agent: z.string(),
  model: z.string(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  durationS: z.number(),
  exitCode: z.number(),
  attempt: z.number(),
  gateResult: z.enum(["PASS", "FAIL"]).optional(),
  reviewVerdict: z.enum(["GO", "NO-GO"]).optional(),
  filesChanged: z.number(),
  linesAdded: z.number(),
  linesDeleted: z.number(),
  gitCommit: z.string(),
  gitBranch: z.string(),
});

export type ExecutionManifest = z.infer<typeof ExecutionManifestSchema>;

/**
 * Writes an execution manifest to specs/<feature>/.gwrk/runs/
 */
export function writeManifest(
  featureDir: string,
  manifest: ExecutionManifest,
): string {
  const runsDir = path.join(featureDir, ".gwrk", "runs");
  if (!fs.existsSync(runsDir)) {
    fs.mkdirSync(runsDir, { recursive: true });
  }

  const result = ExecutionManifestSchema.safeParse(manifest);
  if (!result.success) {
    throw new Error(`Invalid execution manifest: ${result.error.message}`);
  }

  // File naming: <ISO-timestamp>_<command>_<phase>_<agent>.json
  // Sanitize timestamp for filename (replace : with - if needed, though ISO 8601 might have :)
  // ADR-003 shows 2026-03-08T14:02:33Z_ship_p01.json (well, it just says the format)
  // Let's use a filesystem-safe version of the timestamp
  const ts = manifest.startedAt.replace(/:/g, "-");
  const fileName = `${ts}_${manifest.command}_${manifest.phase}_${manifest.agent}.json`;
  const filePath = path.join(runsDir, fileName);

  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2), "utf-8");
  return filePath;
}

/**
 * Loads all manifests for a feature
 */
export function loadManifests(featureDir: string): ExecutionManifest[] {
  const runsDir = path.join(featureDir, ".gwrk", "runs");
  if (!fs.existsSync(runsDir)) {
    return [];
  }

  const files = fs.readdirSync(runsDir).filter((f) => f.endsWith(".json"));
  const manifests: ExecutionManifest[] = [];

  for (const file of files) {
    const filePath = path.join(runsDir, file);
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const result = ExecutionManifestSchema.safeParse(raw);
      if (result.success) {
        manifests.push(result.data);
      } else {
        console.warn(
          `Skipping invalid manifest ${filePath}: ${result.error.message}`,
        );
      }
    } catch (error) {
      console.warn(`Error reading manifest ${filePath}: ${error}`);
    }
  }

  return manifests;
}

/**
 * Generates a runId following the pattern: <ISO-timestamp>_<command>_<phase-shorthand>
 */
export function generateRunId(
  startedAt: string,
  command: string,
  phase: string,
): string {
  // Shorthand phase: phase-01 -> p01
  const phaseShorthand = phase.replace("phase-", "p");
  return `${startedAt}_${command}_${phaseShorthand}`;
}
