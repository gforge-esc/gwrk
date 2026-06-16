/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("FR-H07: Done-Done CLI & Slack Notification", () => {
  it("US-H05: gwrk harvest --help displays help", () => {
    try {
      const output = execSync("node dist/cli.js harvest --help").toString();
      expect(output).toContain("harvest");
    } catch (e) {
      // Expected to fail if CLI command doesn't exist yet
      expect(true).toBe(false);
    }
  });

  it.todo("TR-H07: Full harvest loop - E2E logic");
});
