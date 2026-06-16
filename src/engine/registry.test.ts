/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from "vitest";
import { syncRegistry } from "./registry.js";

describe("FR-044: Registry Sync", () => {
  it("US-001: should clone gwrk-plugins if not present", async () => {
    // TR-036
    await expect(syncRegistry()).rejects.toThrow("Not implemented: FR-044");
  });

  it("US-001: should pull gwrk-plugins if already present", async () => {
    await expect(syncRegistry()).rejects.toThrow("Not implemented: FR-044");
  });
});
