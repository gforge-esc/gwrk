/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import crypto from "node:crypto";

/**
 * Resolve the project ID for a given project root directory.
 *
 * Uses the same MD5 hash algorithm as `gwrk init` (init.ts L276-279)
 * to ensure consistency with the `projects` table registration.
 *
 * This is the canonical way to derive a project_id for DB scoping.
 * All DB queries that need project scoping should use this function.
 */
export function resolveProjectId(projectRoot: string): string {
	return crypto.createHash("md5").update(projectRoot).digest("hex");
}
