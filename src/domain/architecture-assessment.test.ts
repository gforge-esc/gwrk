/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { validateAssessment } from "./architecture-assessment.js";

const sample = () => ({
  overview: "Domain imports filesystem",
  inspected: ["src/domain/policy.ts"],
  limitations: ["Tests not run"],
  findings: [
    {
      id: "F1",
      rule: "Pure domain",
      description: "Filesystem access",
      evidence: [
        { file: "src/domain/policy.ts", line: 2, observation: "Reads file" },
      ],
    },
  ],
  features: [
    {
      id: "pure-core",
      title: "Isolate domain effects",
      summary: "Move filesystem reads to an adapter",
      dependsOn: [],
      findingIds: ["F1"],
      changes: ["Inject file contents"],
      acceptance: ["Domain test proves same input gives same output"],
    },
  ],
  reconciliation: [],
});
describe("assessment contract", () => {
  it("accepts covered findings and ordered features", () => {
    expect(validateAssessment(sample()).features[0].id).toBe("pure-core");
  });
  it("rejects uncovered findings", () => {
    const data = sample();
    data.features = [];
    expect(() => validateAssessment(data)).toThrow(/covered/);
  });
  it("rejects cyclic or unknown dependencies", () => {
    const data = sample();
    data.features[0].dependsOn = ["pure-core"];
    expect(() => validateAssessment(data)).toThrow(/dependency/);
  });
  it("rejects source paths outside the repository and missing evidence", () => {
    const data = sample();
    data.findings[0].evidence[0].file = "../outside.ts";
    expect(() => validateAssessment(data)).toThrow();
  });
  it("rejects duplicate finding identifiers", () => {
    const data = sample();
    data.findings.push(data.findings[0]);
    expect(() => validateAssessment(data)).toThrow(/Duplicate/);
  });
});
