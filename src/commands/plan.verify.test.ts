/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * `plan verify` reports graph self-consistency alongside specs/ drift.
 *
 * Two contracts are load-bearing here:
 *  - A status inversion must be REPORTED. It was invisible before, which is how
 *    `010-reporting-email/phase-01` came to read SHIPPED while all of
 *    `007-audience-redaction` read PLANNED.
 *  - The clean path must keep saying "No drift" verbatim. data-dashboard's
 *    ship-feature.sh greps for that string to decide whether the plan is sound;
 *    rewording it silently turns every run's plan-sync step red.
 */

import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

const inversions: { phaseId: string; blockedBy: string[] }[] = [];

vi.mock("../engine/plan-store.js", () => ({
  PlanStore: vi.fn().mockImplementation(() => ({
    isEmpty: () => false,
    getPlanStatus: () => ({ features: [], edges: [] }),
    getSolver: async () => ({
      getStatusInversions: () => inversions,
    }),
  })),
}));

vi.mock("../engine/drift-detector.js", () => ({
  DriftDetector: vi.fn().mockImplementation(() => ({
    verify: () => [{ featureId: "F", phaseId: "F/phase-01", status: "CLEAN" }],
  })),
}));

describe("gwrk plan verify", () => {
  let program: Command;
  let logged: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    inversions.length = 0;
    const { planCommand } = await import("./plan.js");
    program = new Command();
    program.addCommand(planCommand);
    logged = "";
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      logged += `${a.map(String).join(" ")}\n`;
    });
  });

  it("says 'No drift' when the graph is consistent", async () => {
    await program.parseAsync(["plan", "verify"], { from: "user" });

    expect(logged).toContain("No drift");
  });

  it("reports a status inversion instead of a clean bill of health", async () => {
    inversions.push({
      phaseId: "010-reporting-email/phase-01",
      blockedBy: ["007-audience-redaction/phase-05"],
    });

    await program.parseAsync(["plan", "verify"], { from: "user" });

    expect(logged).toContain("Status Inversions");
    expect(logged).toContain("010-reporting-email/phase-01");
    expect(logged).toContain("007-audience-redaction/phase-05");
    expect(logged).not.toContain("No drift");
  });
});
