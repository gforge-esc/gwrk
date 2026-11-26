/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/portal/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 15_000,
  expect: { timeout: 3_000 },
  globalTimeout: 180_000,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:18793", trace: "retain-on-failure" },
  webServer: {
    command: "node tests/portal/server.mjs",
    url: "http://127.0.0.1:18793",
    reuseExistingServer: false,
    timeout: 10_000,
  },
});
