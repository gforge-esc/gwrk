/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * FR-001 (ADR-005 §10.2.5): a gate whose only assertions are file-existence
 * checks (`test -f`, `[ -f ... ]`) verifies that a file was touched, not that
 * behavior is correct. Such gates are build failures. Comments, `set`, and
 * `echo` lines are ignored when judging. An honest *failing* gate (e.g.
 * `exit 1`) is NOT hollow — it's truthful about the absence of a real test.
 */
export function isHollowGate(gateContent: string): boolean {
  const lines = gateContent
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("set "));

  // A gate that forces a non-zero exit can never pass — it's an honest failing
  // gate, not a hollow one. Catches both the two-line form (`echo …\nexit 1`)
  // and the inline form unauthoredGate emits (`echo …; exit 1`).
  if (lines.some((l) => /\bexit\s+[1-9]/.test(l))) return false;

  // Hollow = every meaningful line is a no-op: a bare echo, or a file-existence
  // check. Such a gate can pass without exercising any behavior. A gate that
  // echoes AND runs a real command (make/pnpm/node/…) is not hollow; nor is an
  // honest failing gate (`exit 1`).
  return (
    lines.length > 0 &&
    lines.every(
      (l) =>
        l.startsWith("echo ") ||
        l === "echo" ||
        l.startsWith("test -f") ||
        l.startsWith("[ -f"),
    )
  );
}

/** The honest-failing gate emitted when no test maps to a source file. */
export function unauthoredGate(filePath: string): string {
  return `echo "FAIL: no test maps to ${filePath} — author one (FR-001, ADR-005 §10)"; exit 1`;
}

/** True when a gate is the {@link unauthoredGate} placeholder — a guaranteed
 * failure meaning "no test was authored", not a real verification gate. */
export function isUnauthoredGate(gateContent: string): boolean {
  return /no test maps to .+ — author one/.test(gateContent);
}

/**
 * 025 — a gate-only phase's executable verification gate, or null if it has none.
 *
 * The canonical `#### Done When` fenced block compiles onto EVERY task's
 * `gateScript` (plan-to-tasks §FR-001, line 333), so the phase gate is the one
 * authored gateScript its tasks share. Prefer that; fall back to prose-bullet
 * `doneWhen` lines (the legacy authoring form). Hollow (`echo`/`test -f` only)
 * and {@link unauthoredGate} placeholder gates do NOT count as verification —
 * a phase whose only gate is one of those is not gate-only and must still block.
 *
 * Reads only the compiled task state (no schema change, no re-`define`), so it
 * works on existing tasks.json where `phase.doneWhen` is empty but the real
 * gate lives in `task.gateScript`.
 */
export function getPhaseVerificationGate(phase: {
  tasks?: { gateScript?: string }[];
  doneWhen?: string[];
}): string | null {
  const taskGates = (phase.tasks ?? [])
    .map((t) => t.gateScript)
    .filter((g): g is string => typeof g === "string" && g.trim().length > 0);
  const distinct = [...new Set(taskGates)];
  const authored = distinct.filter(
    (g) => !isHollowGate(g) && !isUnauthoredGate(g),
  );
  // A fenced Done-When is applied identically to every task, so a real gate-only
  // phase yields exactly one authored gate. Two-or-more distinct authored gates
  // means per-file gates (a test-driven shape), not a single phase gate.
  if (authored.length === 1) return authored[0];

  const prose = (phase.doneWhen ?? []).filter((l) => l.trim().length > 0);
  if (prose.length > 0) return prose.join("\n");

  return null;
}
