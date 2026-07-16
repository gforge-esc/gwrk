import { defineConfig } from "vitest/config";

// Non-hermetic integration tests: they spawn real daemons and share global
// state (fixed ports, PID files, the repo-root .gwrk/dispatches.jsonl), so they
// flake under CI concurrency. `pnpm test` runs them locally; `pnpm test:ci`
// sets GWRK_SKIP_INTEGRATION to quarantine them from the blocking CI gate.
// TODO(gwrk): isolate these (temp dirs, random ports, no shared persistence)
// and remove the quarantine.
const QUARANTINED_INTEGRATION = [
  // Non-hermetic daemon/dispatch integration tests: shared ports/PID/persistence.
  "**/src/server/e2e.test.ts",
  "**/src/server/integration.test.ts",
  "**/src/server/routes/dispatch.test.ts",
  // Slow CLI-spawn suites: node startup latency on CI blows the worker-RPC.
  "**/src/cli.ux.test.ts",
  "**/src/cli.pulse.e2e.test.ts",
  // Other CI-hostile integration tests (carried from develop #96).
  "**/src/**/notify.test.ts",
  "**/src/engine/pulse-integration.test.ts",
];

export default defineConfig({
  test: {
    passWithNoTests: false,
    // Run each test file in a forked child process. Several suites spawn the
    // built CLI / git synchronously (execSync), which blocks a worker thread
    // and stalls Tinypool's RPC ("Timeout calling onTaskUpdate"); process
    // isolation avoids that.
    pool: "forks",
    // Server route tests share PID files — retry once on parallel conflicts
    retry: 1,
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
      ...(process.env.GWRK_SKIP_INTEGRATION ? QUARANTINED_INTEGRATION : []),
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
