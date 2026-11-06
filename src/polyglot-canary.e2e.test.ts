/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectProfile } from "./engine/profile-detector.js";
import { activatePhaseTests } from "./engine/test-activator.js";
import {
  hasRecognizedTestSummary,
  parseTestOutput,
} from "./engine/test-runner.js";
import { resolveEnforcementSkills } from "./plugins/skill-runtime.js";
import { discoverTestFile, generateFilesystemGates } from "./utils/gate-gen.js";
import type { Phase } from "./utils/state.js";
import {
  discoverTestsForSources,
  listTestsTree,
} from "./utils/test-discovery.js";
import {
  getLintCommand,
  getTestCommand,
  getTestExtension,
} from "./utils/toolchain-mapper.js";

describe("035-polyglot-canary-e2e: Full polyglot pipeline across TS, Python, Go, and Rust", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-polyglot-canary-"));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("executes profile detection, skill resolution, test discovery, test activation, and gate generation for TypeScript (Next.js)", async () => {
    const projectDir = path.join(tmpRoot, "ts-nextjs");
    fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "package.json"),
      JSON.stringify({
        name: "canary-nextjs",
        dependencies: { next: "15.0.0", react: "19.0.0" },
        devDependencies: {
          typescript: "5.7.0",
          vitest: "3.0.0",
          "@biomejs/biome": "1.9.0",
        },
      }),
    );
    fs.writeFileSync(
      path.join(projectDir, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n",
    );
    fs.writeFileSync(path.join(projectDir, "tsconfig.json"), "{}");
    fs.writeFileSync(
      path.join(projectDir, "src", "page.ts"),
      "export const page = () => 'ok';\n",
    );
    const testFile = path.join(projectDir, "src", "page.test.ts");
    fs.writeFileSync(
      testFile,
      "// @phase 1\n// @status red\nimport { it, expect } from 'vitest';\nit.skip('renders page', () => { expect(true).toBe(true); });\n",
    );

    const profile = await detectProfile(projectDir);
    expect(profile.stack?.language).toBe("TypeScript");
    expect(profile.stack?.framework).toBe("Next.js");
    expect(profile.toolchain?.test).toBe("vitest");

    const discovered = discoverTestsForSources({
      sourceFiles: ["src/page.ts"],
      mentionedTests: [],
      testExt: getTestExtension(profile),
      fileExists: (rel) => fs.existsSync(path.join(projectDir, rel)),
      testsTreeFiles: listTestsTree(projectDir),
    });
    expect(discovered).toContain("src/page.test.ts");

    const activated = activatePhaseTests(projectDir, "phase-1", [
      "src/page.test.ts",
    ]);
    expect(activated.activated).toBe(1);
    expect(fs.readFileSync(testFile, "utf-8")).not.toContain("it.skip");

    expect(getTestCommand(profile, ["src/page.test.ts"])).toContain(
      "vitest run src/page.test.ts",
    );
    expect(getLintCommand(profile, ["src/page.ts"])).toContain("biome check");
  });

  it("executes profile detection, skill resolution, test discovery, test activation, and gate generation for Python (FastAPI)", async () => {
    const projectDir = path.join(tmpRoot, "py-fastapi");
    fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
    fs.mkdirSync(path.join(projectDir, "tests"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "pyproject.toml"),
      `[project]
name = "canary-fastapi"
dependencies = ["fastapi>=0.115.0"]

[tool.pytest.ini_options]
testpaths = ["tests"]

[tool.ruff]
line-length = 100
`,
    );
    fs.writeFileSync(path.join(projectDir, "uv.lock"), "version = 1\n");
    fs.writeFileSync(
      path.join(projectDir, "src", "routes.py"),
      "def health(): return {'ok': True}\n",
    );
    const testFile = path.join(projectDir, "tests", "test_routes.py");
    fs.writeFileSync(
      testFile,
      "# @phase 1\n# @status red\nimport pytest\n\n@pytest.mark.skip(reason='TDD red')\ndef test_health():\n    assert True\n",
    );

    const profile = await detectProfile(projectDir);
    expect(profile.stack?.language).toBe("Python");
    expect(profile.stack?.framework).toBe("FastAPI");
    expect(profile.toolchain?.test).toBe("pytest");
    expect(profile.toolchain?.primary).toBe("ruff");

    const discovered = discoverTestsForSources({
      sourceFiles: ["src/routes.py"],
      mentionedTests: [],
      testExt: getTestExtension(profile),
      fileExists: (rel) => fs.existsSync(path.join(projectDir, rel)),
      testsTreeFiles: listTestsTree(projectDir),
    });
    expect(discovered).toContain("tests/test_routes.py");

    const activated = activatePhaseTests(projectDir, "phase-1", [
      "tests/test_routes.py",
    ]);
    expect(activated.activated).toBe(1);
    expect(fs.readFileSync(testFile, "utf-8")).not.toContain(
      "@pytest.mark.skip",
    );

    expect(getTestCommand(profile, ["tests/test_routes.py"])).toBe(
      "pytest tests/test_routes.py -v",
    );
    expect(getLintCommand(profile, ["src/routes.py"])).toBe(
      "ruff check src/routes.py",
    );

    const skills = await resolveEnforcementSkills(projectDir, "all", profile);
    expect(skills).toContain("Python");
    expect(skills).not.toContain("Biome");
  });

  it("executes profile detection, skill resolution, test discovery, test activation, and gate generation for Go (Gin)", async () => {
    const projectDir = path.join(tmpRoot, "go-gin");
    fs.mkdirSync(path.join(projectDir, "pkg", "server"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "go.mod"),
      "module example.com/canary-gin\n\ngo 1.23\n\nrequire github.com/gin-gonic/gin v1.10.0\n",
    );
    fs.writeFileSync(
      path.join(projectDir, ".golangci.yml"),
      "linters:\n  enable:\n    - govet\n",
    );
    fs.writeFileSync(
      path.join(projectDir, "pkg", "server", "router.go"),
      "package server\n",
    );
    const testFile = path.join(projectDir, "pkg", "server", "router_test.go");
    fs.writeFileSync(
      testFile,
      '// @phase 1\n// @status red\npackage server\nimport "testing"\nfunc TestRouter(t *testing.T) {\n\tt.Skip("TDD red")\n}\n',
    );

    const profile = await detectProfile(projectDir);
    expect(profile.stack?.language).toBe("Go");
    expect(profile.stack?.framework).toBe("Gin");
    expect(profile.toolchain?.test).toBe("go-test");
    expect(profile.toolchain?.primary).toBe("golangci-lint");

    const discovered = discoverTestsForSources({
      sourceFiles: ["pkg/server/router.go"],
      mentionedTests: [],
      testExt: getTestExtension(profile),
      fileExists: (rel) => fs.existsSync(path.join(projectDir, rel)),
      testsTreeFiles: listTestsTree(projectDir),
    });
    expect(discovered).toContain("pkg/server/router_test.go");

    const activated = activatePhaseTests(projectDir, "phase-1", [
      "pkg/server/router_test.go",
    ]);
    expect(activated.activated).toBe(1);
    expect(fs.readFileSync(testFile, "utf-8")).not.toContain(
      't.Skip("TDD red")',
    );

    expect(getTestCommand(profile, ["pkg/server/router_test.go"])).toBe(
      "go test pkg/server/router_test.go -v",
    );
    expect(getLintCommand(profile, ["pkg/server/router.go"])).toBe(
      "golangci-lint run pkg/server/router.go",
    );

    const skills = await resolveEnforcementSkills(projectDir, "all", profile);
    expect(skills).toContain("Go");
  });

  it("executes profile detection, skill resolution, test discovery, test activation, and gate generation for Rust (Axum)", async () => {
    const projectDir = path.join(tmpRoot, "rust-axum");
    fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "Cargo.toml"),
      `[package]
name = "canary-axum"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = "0.7"

[lints.clippy]
all = "warn"
`,
    );
    const srcFile = path.join(projectDir, "src", "handler.rs");
    fs.writeFileSync(srcFile, 'pub fn ok() -> &\'static str { "ok" }\n');
    const testFile = path.join(projectDir, "src", "handler_test.rs");
    fs.writeFileSync(
      testFile,
      '// @phase 1\n// @status red\n#[test]\n#[ignore = "TDD red"]\nfn test_ok() {\n    assert_eq!(1, 1);\n}\n',
    );

    const profile = await detectProfile(projectDir);
    expect(profile.stack?.language).toBe("Rust");
    expect(profile.stack?.framework).toBe("Axum");
    expect(profile.toolchain?.test).toBe("cargo-test");
    expect(profile.toolchain?.primary).toBe("clippy");

    const discovered = discoverTestsForSources({
      sourceFiles: ["src/handler.rs"],
      mentionedTests: [],
      testExt: getTestExtension(profile),
      fileExists: (rel) => fs.existsSync(path.join(projectDir, rel)),
      testsTreeFiles: listTestsTree(projectDir),
    });
    expect(discovered).toContain("src/handler_test.rs");

    const activated = activatePhaseTests(projectDir, "phase-1", [
      "src/handler_test.rs",
    ]);
    expect(activated.activated).toBe(1);
    expect(fs.readFileSync(testFile, "utf-8")).not.toContain("#[ignore");

    expect(discoverTestFile(srcFile)).toBe(testFile);

    const featureDir = path.join(projectDir, "specs", "001-canary");
    fs.mkdirSync(featureDir, { recursive: true });
    const phases: Phase[] = [
      {
        name: "Phase 1",
        tasks: [
          {
            id: "T001",
            title: `Implement ${srcFile}`,
            done: false,
            points: 1,
          },
        ],
      },
    ];
    const gateRes = generateFilesystemGates(featureDir, phases);
    expect(gateRes.generated).toBe(1);
    const gateScript = fs.readFileSync(
      path.join(featureDir, "gates", "T001-gate.sh"),
      "utf-8",
    );
    expect(gateScript).toContain("cargo test --test handler_test");

    const skills = await resolveEnforcementSkills(projectDir, "all", profile);
    expect(skills).toContain("Rust");
  });

  it("parses multi-binary cargo test output and go test -json NDJSON output accurately", () => {
    const cargoMultiBinaryOutput = `
     Running unittests src/lib.rs (target/debug/deps/canary_axum-1234)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running tests/api_integration.rs (target/debug/deps/api_integration-5678)

running 3 tests
test health_returns_200 ... ok
test create_item_validates_payload ... ok
test unauthorized_rejected ... FAILED

test result: FAILED. 2 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
`;
    expect(hasRecognizedTestSummary(cargoMultiBinaryOutput)).toBe(true);
    const cargoParsed = parseTestOutput(cargoMultiBinaryOutput);
    expect(cargoParsed).toEqual({
      testsRun: 3,
      passed: 2,
      failed: 1,
    });

    const goJsonOutput = [
      JSON.stringify({
        Time: "2026-11-05T18:00:00Z",
        Action: "run",
        Package: "example.com/gin",
        Test: "TestHealth",
      }),
      JSON.stringify({
        Time: "2026-11-05T18:00:01Z",
        Action: "pass",
        Package: "example.com/gin",
        Test: "TestHealth",
        Elapsed: 0.01,
      }),
      JSON.stringify({
        Time: "2026-11-05T18:00:01Z",
        Action: "run",
        Package: "example.com/gin",
        Test: "TestAuth",
      }),
      JSON.stringify({
        Time: "2026-11-05T18:00:02Z",
        Action: "fail",
        Package: "example.com/gin",
        Test: "TestAuth",
        Elapsed: 0.02,
      }),
      JSON.stringify({
        Time: "2026-11-05T18:00:02Z",
        Action: "fail",
        Package: "example.com/gin",
        Elapsed: 0.03,
      }),
    ].join("\n");

    expect(hasRecognizedTestSummary(goJsonOutput)).toBe(true);
    const goParsed = parseTestOutput(goJsonOutput);
    expect(goParsed).toEqual({
      testsRun: 2,
      passed: 1,
      failed: 1,
    });
  });
});
