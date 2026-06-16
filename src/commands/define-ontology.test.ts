/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, vi } from "vitest";
import { defineOntologyCommand } from "./define-ontology";
import * as scaffoldModule from "../engine/ontology-scaffold";

vi.mock("../engine/ontology-scaffold");

describe("US-020, US-021: Define Ontology Command", () => {
  it("US-020: should trigger scaffolding by default", async () => {
    const scaffoldSpy = vi.spyOn(scaffoldModule, "scaffold");
    await defineOntologyCommand({});
    expect(scaffoldSpy).toHaveBeenCalled();
  });

  it("US-021: should not run construction workflow if --run is missing", async () => {
    // This would check if the workflow engine was NOT called
    // Placeholder for implementation verification
  });
});
