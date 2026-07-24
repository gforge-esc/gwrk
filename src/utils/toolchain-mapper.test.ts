/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProjectProfile } from "../engine/prompt-conditioner.js";
import {
  getBuildCommand,
  getSourceExtension,
  getTestCommand,
  getTestExtension,
} from "./toolchain-mapper.js";

const p = (over: Partial<ProjectProfile>): ProjectProfile => ({
  type: "test",
  ...over,
});

describe("getTestExtension (021 FR-002 — profile-aware, JS first-class)", () => {
  it("JavaScript → .test.js (the load-bearing fix)", () => {
    expect(getTestExtension(p({ stack: { language: "JavaScript" } }))).toBe(
      ".test.js",
    );
  });
  it("TypeScript → .test.ts (regression guard)", () => {
    expect(getTestExtension(p({ stack: { language: "TypeScript" } }))).toBe(
      ".test.ts",
    );
  });
  it("Python → .py", () => {
    expect(getTestExtension(p({ stack: { language: "Python" } }))).toBe(".py");
  });
  it("toolchain.testExtension override wins over language inference", () => {
    expect(
      getTestExtension(
        p({
          stack: { language: "TypeScript" },
          toolchain: { testExtension: ".spec.js" },
        }),
      ),
    ).toBe(".spec.js");
  });
});

describe("getSourceExtension (021 FR-002)", () => {
  it("JavaScript → .js", () => {
    expect(getSourceExtension(p({ stack: { language: "JavaScript" } }))).toBe(
      ".js",
    );
  });
  it("sourceExtension override wins", () => {
    expect(
      getSourceExtension(
        p({ stack: { language: "Go" }, toolchain: { sourceExtension: ".mjs" } }),
      ),
    ).toBe(".mjs");
  });
});

describe("getTestCommand (021 FR-003 — string | null)", () => {
  it("test: null → null (skip)", () => {
    expect(getTestCommand(p({ toolchain: { test: null } }), [])).toBeNull();
  });
  it("testCommand wins over test enum; {files} substituted", () => {
    expect(
      getTestCommand(
        p({ toolchain: { test: "vitest", testCommand: "node --test {files}" } }),
        ["a.test.js"],
      ),
    ).toBe("node --test a.test.js");
  });
  it("testCommand without {files} and no files → verbatim (e.g. make target)", () => {
    expect(
      getTestCommand(p({ toolchain: { testCommand: "make test:auth" } }), []),
    ).toBe("make test:auth");
  });
  it("node-test harness → node --test <files>", () => {
    expect(
      getTestCommand(p({ toolchain: { test: "node-test" } }), ["a.test.js"]),
    ).toBe("node --test a.test.js");
  });
  it("JS project with no toolchain → infers vitest (non-null)", () => {
    const cmd = getTestCommand(p({ stack: { language: "JavaScript" } }), ["a"]);
    expect(cmd).toContain("vitest");
  });
});

describe("getBuildCommand (021 FR-004 — string | null)", () => {
  it("build: null → null (skip)", () => {
    expect(getBuildCommand(p({ toolchain: { build: null } }), "/nonexistent")).toBeNull();
  });
  it("explicit build string → used verbatim", () => {
    expect(
      getBuildCommand(p({ toolchain: { build: "next build" } }), "/nonexistent"),
    ).toBe("next build");
  });

  describe("inference from filesystem", () => {
    let dir: string;
    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-buildcmd-"));
      fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ scripts: { build: "tsc" } }),
      );
      fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "");
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it("package.json scripts.build + pnpm-lock → pnpm build", () => {
      expect(getBuildCommand(p({}), dir)).toBe("pnpm build");
    });
    it("no build script anywhere → null", () => {
      const empty = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-nobuild-"));
      expect(getBuildCommand(p({}), empty)).toBeNull();
      fs.rmSync(empty, { recursive: true, force: true });
    });
    it("package.json with no build script → null (commits to node; no fall-through to a co-present Cargo.toml)", () => {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-node-nobuild-"));
      fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ name: "x" }));
      fs.writeFileSync(path.join(d, "Cargo.toml"), "[package]");
      expect(getBuildCommand(p({}), d)).toBeNull();
      fs.rmSync(d, { recursive: true, force: true });
    });
  });
});
