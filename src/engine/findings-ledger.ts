/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The store of record for a blocking review finding (FR-009).
 *
 * `task.description` is where a review agent writes its finding, and it is the
 * only channel that survives `revertSourceMutations()` — but it is a *mirror*,
 * not the truth. Every later agent rewrites tasks.json wholesale, and twice
 * (`48c3ea6`, `5b29881`) that rewrite silently deleted a real, unresolved
 * finding. The phase then shipped with the defect live and the console reading
 * GO.
 *
 * The defence is structural rather than procedural. A finding is appended to a
 * line-oriented sibling file, `specs/<feature-id>/.gwrk/findings.jsonl`, with
 * `fs.appendFileSync`. There is no read-modify-write step to lose data in, no
 * exported function that takes an index or an id to update, and no code path
 * here that opens the file for writing with truncation. Rewriting an entry is
 * not forbidden by policy; it is unexpressible through this surface. That is
 * what makes D3's erasure mode unable to recur, and it is why the ledger is a
 * file rather than a `findings[]` array inside tasks.json — an array would
 * inherit exactly the exposure it is meant to close.
 *
 * TC-008: no SQLite, no migration, no build server. The verdict path must work
 * from a bare clone with nothing running but git and the filesystem.
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * One line of `findings.jsonl`.
 *
 * `taskId` and `phaseId` carry the same regexes as `TaskSchema.id` and
 * `PhaseSchema.id` in src/utils/state.ts — `phase-\d{2}` zero-padded, because
 * the bare-number form is D9. `recordedAt` is when the orchestrator recorded
 * the finding, not when the agent wrote it: the agent's clock is not ours to
 * trust, and the ordering that matters is the ordering of dispatches.
 */
export const FindingSchema = z.object({
  taskId: z.string().regex(/^T\d{3}$/),
  phaseId: z.string().regex(/^phase-\d{2}$/),
  stage: z.enum(["code-review", "uat-review"]),
  text: z.string().min(1),
  recordedAt: z.string().datetime(),
});

export type Finding = z.infer<typeof FindingSchema>;

/**
 * Where the ledger lives for a feature: `<featureDir>/.gwrk/findings.jsonl`.
 *
 * `featureDir` is the absolute path to `specs/<feature-id>` — the same argument
 * `loadTaskState` takes, so the ledger sits beside tasks.json.
 *
 * Exported so `revertSourceMutations()` can snapshot the exact path it has to
 * preserve instead of re-deriving it and drifting from this module.
 */
export function findingsPath(featureDir: string): string {
  return path.join(featureDir, ".gwrk", "findings.jsonl");
}

/**
 * Append one finding. Never rewrites, never truncates, never reads.
 *
 * Validation is strict on the way in — a malformed entry throws rather than
 * landing in the file, so nothing invalid is ever written. An unwritable path
 * throws too, and deliberately: a finding that cannot be recorded MUST be loud,
 * since silence over a real finding is the defect this ledger exists to repair.
 */
export function appendFinding(featureDir: string, finding: Finding): void {
  const entry = FindingSchema.parse(finding);
  const file = findingsPath(featureDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf-8");
}

/**
 * Every valid entry, oldest first. `[]` when the file does not exist.
 *
 * Never throws. A line that is not valid JSON, or that fails `FindingSchema`,
 * is skipped and the rest of the file is still returned.
 *
 * The asymmetry with the write side is deliberate, and it is the whole point:
 * the ledger exists so a finding survives damage elsewhere, so one bad line — a
 * partial write, a stray edit — must not take every other recorded finding down
 * with it. A scoped exception to the repository's fail-fast rule, of the same
 * kind and for the same reason as FR-010's verdict parse (TC-002): the failure
 * mode being avoided is losing evidence.
 */
export function readFindings(featureDir: string): Finding[] {
  let raw: string;
  try {
    raw = fs.readFileSync(findingsPath(featureDir), "utf-8");
  } catch {
    return [];
  }

  const findings: Finding[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const result = FindingSchema.safeParse(parsed);
    if (result.success) findings.push(result.data);
  }
  return findings;
}
