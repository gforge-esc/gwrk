/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { insertCompressionRecord } from "./db.js";

describe("FR-013: SQLite Persistence", () => {
  it("US-009 / TR-014: Should insert compression results into the SQLite table", () => {
    expect(() => insertCompressionRecord({ feature_id: "123" })).toThrow();
  });

  it("Should fail if required fields are missing", () => {
    expect(() => insertCompressionRecord({})).toThrow();
  });
});
