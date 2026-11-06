/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

test.describe("Phase 15: Profile-Aware Enforcement Routing (US-016)", () => {
  const projectDir = "tmp/python-project";

  test.beforeAll(() => {
    if (existsSync(projectDir)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(path.join(projectDir, ".gwrk"), { recursive: true });

    // Create a mock .gwrkrc.json that suggests Python
    writeFileSync(
      path.join(projectDir, ".gwrkrc.json"),
      JSON.stringify({
        profile: {
          type: "python",
          stack: { language: "Python" },
        },
      }),
    );

    // Create a requirements.txt to help detection
    writeFileSync(path.join(projectDir, "requirements.txt"), "");
  });

  test.afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  test("US-016: Python project should not list typescript-standards", () => {
    const output = execSync(
      "pnpm gwrk plugin list --project --type skill --tier enforcement",
      {
        cwd: projectDir,
      },
    ).toString();

    // Should fail (RED) because implementation might not be filtering the 'list' output yet
    expect(output).not.toContain("typescript-standards");
  });

  test("FR-014: resolveEnforcementSkills filters by framework", () => {
    // This is hard to test via CLI without a command that specifically calls resolveEnforcementSkills
    // and outputs the result. But 'plugin list' is our best proxy.
    // If we have a 'react-standards' builtin, it should be filtered out in a Python project.
    const output = execSync("pnpm gwrk plugin list --project", {
      cwd: projectDir,
    }).toString();

    expect(output).not.toContain("react-standards");
  });
});
