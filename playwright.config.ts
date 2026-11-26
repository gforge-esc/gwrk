/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { defineConfig } from "@playwright/test";

const remoteBaseURL = process.env.GWRK_PORTAL_BASE_URL;
let baseURL = "http://127.0.0.1:18793";
if (remoteBaseURL !== undefined) {
  let remote: URL;
  try {
    remote = new URL(remoteBaseURL);
  } catch {
    throw new Error(
      "GWRK_PORTAL_BASE_URL must be an HTTPS origin without credentials, path, query or fragment",
    );
  }
  if (
    remote.protocol !== "https:" ||
    remote.username ||
    remote.password ||
    remote.pathname !== "/" ||
    remote.search ||
    remote.hash
  ) {
    throw new Error(
      "GWRK_PORTAL_BASE_URL must be an HTTPS origin without credentials, path, query or fragment",
    );
  }
  baseURL = remote.origin;
}

export default defineConfig({
  testDir: "./tests/portal/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: remoteBaseURL ? 30_000 : 15_000,
  expect: { timeout: remoteBaseURL ? 10_000 : 3_000 },
  globalTimeout: 300_000,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    navigationTimeout: 15_000,
    actionTimeout: 10_000,
  },
  webServer: remoteBaseURL
    ? undefined
    : {
        command: "node tests/portal/server.mjs",
        url: "http://127.0.0.1:18793",
        reuseExistingServer: false,
        timeout: 10_000,
      },
});
