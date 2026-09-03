/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Command } from "commander";

/**
 * Merge a subcommand's own options with those its ancestors parsed.
 *
 * When the same flag is declared on BOTH a subcommand and an intermediate
 * ancestor that has its own positional argument and action — which describes
 * `gwrk define` exactly — commander binds the value to the ANCESTOR. The
 * subcommand's `opts()` comes back without the key at all, and because the
 * option IS declared somewhere, no "unknown option" error is raised. The flag is
 * silently discarded.
 *
 * That is how `gwrk define spec 012 "…" --dry-run` ran for real: `specify.ts`
 * read its own `opts.dryRun`, got `undefined`, and dispatched an agent. `--refs`
 * was lost the same way, on the very form the `--help` examples advertise.
 *
 * Root-program collisions do NOT have this problem — commander exposes
 * root-level options to descendants — which is why `gwrk ship --agent` has
 * always worked. Only an intermediate parent swallows.
 *
 * The subcommand's own values win where present, so an explicitly-parsed flag is
 * never overridden by an ancestor's default.
 */
export function withParentFlags<T extends object>(opts: T, command: Command): T {
  return { ...(command.optsWithGlobals() as T), ...opts };
}
