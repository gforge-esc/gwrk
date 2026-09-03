/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * An option declared on both a subcommand and an INTERMEDIATE ancestor is
 * silently discarded by commander.
 *
 * The value binds to the ancestor, the subcommand's `opts()` arrives without the
 * key, and no "unknown option" error fires because the option IS declared —
 * just one level up. `gwrk define spec 012 "…" --dry-run` therefore dispatched a
 * real agent, and `--refs` was dropped on the form the `--help` text advertises.
 *
 * Root-program collisions are NOT affected — commander exposes root options to
 * descendants, which is why `gwrk ship --agent` always worked. Verified across
 * all 22 collisions in the tree: the 8 under `define` swallowed, the other 14
 * (all root-parented) resolved correctly.
 *
 * This test freezes the blast radius. Any NEW intermediate-parent collision has
 * to be either avoided or routed through `withParentFlags`, and then listed here
 * deliberately — rather than shipping as another flag that silently does nothing.
 */

import { describe, expect, it } from "vitest";
import type { Command } from "commander";

/**
 * Collisions that are known, and handled by `withParentFlags` in the
 * subcommand's action. Format: "<command path> <long flag>".
 */
const HANDLED = new Set([
  "define spec --refs",
  "define spec --dry-run",
  "define plan --refs",
  "define plan --dry-run",
  "define tasks --dry-run",
  "define tests --dry-run",
  "define analyze --dry-run",
  "define research --refs",
  "define ontology --refs",
]);

/**
 * Intermediate collisions empirically verified to reach the subcommand anyway.
 *
 * Not every intermediate parent swallows — only one that also declares its own
 * positional argument and action handler, which is what `define` does. `pulse`
 * is a bare grouping command, and a parse probe confirmed `--json` arrives in
 * `scan`'s own opts(). Listed separately from HANDLED because nothing was
 * changed here: the entry records a verification, not a fix.
 */
const VERIFIED_BENIGN = new Set(["measure pulse scan --json"]);

/** Every option declared on both a command and a non-root ancestor. */
function intermediateCollisions(program: Command): string[] {
  const hits: string[] = [];

  const walk = (cmd: Command, ancestors: Command[]) => {
    const own = new Set(
      cmd.options.map((o) => o.long).filter((l): l is string => Boolean(l)),
    );
    // ancestors[0] is the root program — its options are commander globals and
    // reach descendants correctly, so only intermediates are a hazard.
    for (const ancestor of ancestors.slice(1)) {
      for (const opt of ancestor.options) {
        if (opt.long && own.has(opt.long)) {
          const path = [...ancestors.slice(1).map((a) => a.name()), cmd.name()];
          hits.push(`${path.join(" ")} ${opt.long}`);
        }
      }
    }
    for (const sub of cmd.commands) walk(sub, [...ancestors, cmd]);
  };

  for (const cmd of program.commands) walk(cmd, [program]);
  return hits;
}

describe("CLI option collisions", () => {
  it("has no intermediate-parent collision that is not deliberately handled", async () => {
    // cli.ts guards its own parse() behind an import.meta check, so importing
    // the real program does not execute anything.
    const { program } = await import("./cli.js");

    const unhandled = intermediateCollisions(program).filter(
      (c) => !HANDLED.has(c) && !VERIFIED_BENIGN.has(c),
    );

    expect(unhandled).toEqual([]);
  });

  it("still sees the known define collisions, so the guard cannot rot silently", async () => {
    // If commander's binding ever changes, or these declarations are removed,
    // this fails and HANDLED should shrink — rather than leaving a stale
    // allowlist that would mask a genuinely new collision.
    const { program } = await import("./cli.js");

    expect(new Set(intermediateCollisions(program))).toEqual(
      new Set([...HANDLED, ...VERIFIED_BENIGN]),
    );
  });
});
