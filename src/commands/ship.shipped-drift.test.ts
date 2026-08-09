/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Re-shipping an already-shipped phase must never be silent.
 *
 * `gwrk ship <feature>` with no phase argument selects phases from tasks.json.
 * The plan graph is the other record of the same fact, and the two can disagree
 * — on 005-dashboard-api tasks.json read T002..T007 `open` while the graph read
 * phase-02..05 `SHIPPED`, because regenerating tasks.json had wiped the
 * completion flags. The run announced six phases and re-implemented phase 02,
 * producing a PR with zero source changes.
 *
 * Neither record is authoritative enough to overrule the other: tasks.json is
 * destroyed by a define pass, and the graph's SHIPPED is promoted from ship-run
 * existence rather than a passing gate. So the disagreement is surfaced and the
 * run stops, rather than one side being silently believed. `--force` overrides.
 */

import { describe, expect, it } from "vitest";
import { findShippedDrift } from "./ship.js";

describe("findShippedDrift", () => {
  const graph = new Map([
    ["005-dashboard-api/phase-01", "SHIPPED"],
    ["005-dashboard-api/phase-02", "SHIPPED"],
    ["005-dashboard-api/phase-03", "SHIPPED"],
    ["005-dashboard-api/phase-04", "SHIPPED"],
    ["005-dashboard-api/phase-05", "SHIPPED"],
    ["005-dashboard-api/phase-06", "PLANNED"],
    ["005-dashboard-api/phase-07", "PLANNED"],
  ]);

  it("names every selected phase the graph already considers shipped", () => {
    // The exact 005 selection after the completion flags were wiped.
    const drift = findShippedDrift(
      "005-dashboard-api",
      ["02", "03", "04", "05", "06", "07"],
      graph,
    );

    expect(drift).toEqual([
      "005-dashboard-api/phase-02",
      "005-dashboard-api/phase-03",
      "005-dashboard-api/phase-04",
      "005-dashboard-api/phase-05",
    ]);
  });

  it("reports nothing when the selection is genuinely unshipped work", () => {
    expect(findShippedDrift("005-dashboard-api", ["06", "07"], graph)).toEqual([]);
  });

  it("treats every terminal status as shipped, not just SHIPPED", () => {
    const terminal = new Map([
      ["F/phase-01", "DONE"],
      ["F/phase-02", "VERIFIED"],
      ["F/phase-03", "CLOSED"],
    ]);

    expect(findShippedDrift("F", ["01", "02", "03"], terminal)).toEqual([
      "F/phase-01",
      "F/phase-02",
      "F/phase-03",
    ]);
  });

  it("reports nothing when the phase is absent from the graph", () => {
    // A feature never seeded into the graph must not be blocked from shipping.
    expect(findShippedDrift("999-new", ["01"], graph)).toEqual([]);
  });

  it("pads single-digit phase numbers to match graph ids", () => {
    expect(findShippedDrift("005-dashboard-api", ["2"], graph)).toEqual([
      "005-dashboard-api/phase-02",
    ]);
  });
});
