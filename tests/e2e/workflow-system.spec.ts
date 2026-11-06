/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { expect, test } from "@playwright/test";

test.describe("F014 WorkflowRuntime E2E", () => {
  test("US-011: Execute a built-in workflow", async ({ page }) => {
    expect(true).toBe(false);
  });
});
