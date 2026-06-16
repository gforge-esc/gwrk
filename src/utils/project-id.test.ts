/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from "vitest";
import { resolveProjectId } from "./project-id.js";

describe("resolveProjectId (FR-036 / TR-035)", () => {
  it("should generate a consistent MD5 hash for the same path", () => {
    const path = "/Users/gonzo/Code/gwrk";
    const id1 = resolveProjectId(path);
    const id2 = resolveProjectId(path);
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[a-f0-9]{32}$/);
  });

  it("should generate different IDs for different paths", () => {
    const id1 = resolveProjectId("/path/A");
    const id2 = resolveProjectId("/path/B");
    expect(id1).not.toBe(id2);
  });
});
