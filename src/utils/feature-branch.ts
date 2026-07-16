/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export interface ParsedFeatureBranch {
	featureId: string;
	/** Canonical zero-padded phase, e.g. `phase-01`. Absent for feature branches. */
	phaseId?: string;
}

/**
 * Parse a ship branch name into feature/phase, canonicalizing the phase to the
 * zero-padded `phase-NN` form used everywhere else (tasks.json, run state).
 *
 * Single source of truth for both harvest triggers — the poll-based
 * HarvestWatcher and the push-based GitHub webhook. They previously parsed
 * branches independently and disagreed on phase padding (`phase-1` vs
 * `phase-01`), so a PR seen by both produced two different phase IDs, defeating
 * harvest's idempotency guard and double-firing the Done-Done notification
 * (FR-H11). Returns null for branches that aren't ship branches.
 */
export function parseFeatureBranch(
	headRef: string | undefined | null,
): ParsedFeatureBranch | null {
	if (!headRef) return null;
	const match = headRef.match(/^(?:feat|phase)\/(.+)$/);
	if (!match) return null;

	const rest = match[1];
	const phaseMatch = rest.match(/^(.+)-phase-(\d+)$/);
	if (phaseMatch) {
		return {
			featureId: phaseMatch[1],
			phaseId: `phase-${phaseMatch[2].padStart(2, "0")}`,
		};
	}
	return { featureId: rest };
}
