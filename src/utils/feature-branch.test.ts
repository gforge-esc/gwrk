/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { parseFeatureBranch } from "./feature-branch.js";

describe("parseFeatureBranch", () => {
  it("parses a feat/ phase branch and zero-pads the phase", () => {
    expect(parseFeatureBranch("feat/014-plugin-system-phase-1")).toEqual({
      featureId: "014-plugin-system",
      phaseId: "phase-01",
    });
  });

  it("canonicalizes phase padding identically regardless of input width", () => {
    // The whole point: webhook and poller must agree so idempotency holds.
    const a = parseFeatureBranch("feat/x-phase-1");
    const b = parseFeatureBranch("feat/x-phase-01");
    expect(a).toEqual(b);
    expect(a?.phaseId).toBe("phase-01");
  });

  it("accepts the phase/ prefix too (poller emits both)", () => {
    expect(parseFeatureBranch("phase/001-cli-core-phase-03")).toEqual({
      featureId: "001-cli-core",
      phaseId: "phase-03",
    });
  });

  it("returns a feature with no phase for a bare feat/ branch", () => {
    expect(parseFeatureBranch("feat/001-platform-foundation")).toEqual({
      featureId: "001-platform-foundation",
    });
  });

  it("returns null for a non-feature branch", () => {
    expect(parseFeatureBranch("main")).toBeNull();
    expect(parseFeatureBranch("chore/reconcile")).toBeNull();
  });
});
