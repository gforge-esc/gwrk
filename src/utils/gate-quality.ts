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
