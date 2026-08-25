/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The review agent's returned structured verdict, read as a one-way ratchet
 * (FR-010).
 *
 * Every review PROMPT.md asks for a final JSON object carrying a `verdict`
 * field, and `ReviewResult.verdict` has been declared at
 * `src/plugins/review-plugin.ts:45` the whole time — consumed nowhere. Run
 * #2728 iteration 2 is the case that leaves: the agent returned
 * `"verdict": "NO-GO"`, every gate was green, no task was re-opened, and the
 * console printed GO. Nothing else in the verdict path can catch that one,
 * because the agent's only surviving *evidence* channel is tasks.json and it
 * wrote nothing there.
 *
 * TC-006 forbids this ever growing teeth in the other direction, and the
 * enforcement is the return type rather than a comment: a returned `GO` is
 * **unrepresentable** in this function's output. No future edit can make the
 * agent's word override gate or re-open evidence without changing a signature
 * the phase gate greps for.
 */

/**
 * A returned NO-GO, in the three shapes it actually arrives in.
 *
 * One scan covers all three because they differ only in what *surrounds* the
 * `"verdict": "NO-GO"` pair — a bare JSON object, a ```json fence, or the pair
 * loose in prose the agent wrapped around it. A scan is indifferent to the
 * surroundings, and it keeps reading where `JSON.parse` gives up: agent stdout
 * is routinely truncated mid-object, and a verdict that is still perfectly
 * legible must not be lost to a missing closing brace.
 *
 * The key must be double-quoted, which is the whole point of the tightness
 * there: the review prompts describe the field as `` `verdict` `` in backticks
 * and gloss it as `"GO" if all checks pass …, "NO-GO" otherwise`, so an agent
 * quoting the format spec back at us cannot trip the ratchet. The *value* side
 * is tolerant — case, and `-`/`_`/space/nothing as the separator — because a
 * missed NO-GO ships a live defect while a spurious one costs a DIAGNOSE loop.
 * The asymmetry in what this pattern forgives follows the asymmetry in cost.
 */
const RETURNED_NO_GO = /"verdict"\s*:\s*"\s*no[-_ ]?go\s*"/i;

/**
 * Scan agent stdout for a returned blocking verdict.
 *
 * Returns `"NO-GO"` if the agent said so anywhere in its output, `undefined`
 * otherwise — including for a returned `"GO"`, which is not "no verdict" but is
 * treated identically, because it is ignored (TC-006). `undefined` therefore
 * means exactly one thing to the caller: *leave the gate + re-open computation
 * alone*.
 *
 * Never throws, on any input. That is a deliberate, documented exception to the
 * repository's Fail-Fast rule (TC-002), of the same kind as the read side of
 * {@link file://./findings-ledger.ts}: a run must not die because an agent
 * formatted its summary badly, and adding a new way to hard-fail on agent
 * formatting is precisely what FR-010 was not allowed to do.
 *
 * Any NO-GO found wins, regardless of position. There is no last-match-wins
 * rule to write, because a returned GO carries no weight to cancel it with —
 * which is what makes this a ratchet rather than a vote.
 */
export function parseReturnedVerdict(stdout: string): "NO-GO" | undefined {
  if (typeof stdout !== "string" || stdout.length === 0) return undefined;
  return RETURNED_NO_GO.test(stdout) ? "NO-GO" : undefined;
}
