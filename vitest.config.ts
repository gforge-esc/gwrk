/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: false,
    // Run each test file in a forked child process. Several suites spawn the
    // built CLI / git synchronously (execSync), which blocks a worker thread
    // and stalls Tinypool's RPC ("Timeout calling onTaskUpdate"); process
    // isolation avoids that.
    pool: "forks",
    // e2e/integration suites spawn the built CLI and real daemons; a single
    // pulse scan run is ~2.5s locally and ~5s+ on CI, and VR-004 runs two in
    // series. The 5s default is too tight on CI runners — give them headroom.
    testTimeout: 30000,
    hookTimeout: 30000,
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.runs/**",
      "**/specs/**",
      "**/.test-mocks-*/**",
      "**/e2e/**",
      "tests/hosted-pilot/gate-completeness.test.mjs",
      ...(process.env.CI === "true"
        ? [
            "tests/hosted-pilot/fixtures/**",
            "tests/hosted-pilot/gateway-startup.test.ts",
            "tests/hosted-pilot/tls-preflight.test.ts",
          ]
        : []),
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      all: true,
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/types.ts", "src/**/*.d.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
