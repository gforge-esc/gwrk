import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveFeature } from "./resolve-feature.js";

describe("resolveFeature", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-resolve-"));
    const specsDir = path.join(tmpDir, "specs");
    fs.mkdirSync(specsDir);

    // Create test feature directories
    fs.mkdirSync(path.join(specsDir, "001-cli-core"));
    fs.mkdirSync(path.join(specsDir, "002-build-server"));
    fs.mkdirSync(path.join(specsDir, "003-slack"));
    fs.mkdirSync(path.join(specsDir, "011-harvest"));
    fs.mkdirSync(path.join(specsDir, "018-build-plan-orchestrator"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should return exact match when full name provided", () => {
    expect(resolveFeature("003-slack", tmpDir)).toBe("003-slack");
  });

  it("should resolve numeric prefix to full name", () => {
    expect(resolveFeature("003", tmpDir)).toBe("003-slack");
  });

  it("should resolve multi-digit prefix", () => {
    expect(resolveFeature("018", tmpDir)).toBe("018-build-plan-orchestrator");
  });

  it("should resolve prefix with leading zero", () => {
    expect(resolveFeature("011", tmpDir)).toBe("011-harvest");
  });

  it("should throw on ambiguous prefix matching multiple features", () => {
    expect(() => resolveFeature("00", tmpDir)).toThrow(/Ambiguous/);
    expect(() => resolveFeature("00", tmpDir)).toThrow(/001-cli-core/);
    expect(() => resolveFeature("00", tmpDir)).toThrow(/002-build-server/);
    expect(() => resolveFeature("00", tmpDir)).toThrow(/003-slack/);
  });

  it("should throw on unknown feature with available list", () => {
    expect(() => resolveFeature("999", tmpDir)).toThrow(/Feature not found/);
    expect(() => resolveFeature("999", tmpDir)).toThrow(/001-cli-core/);
  });

  it("should throw when specs directory does not exist", () => {
    const noSpecsDir = path.join(tmpDir, "nonexistent");
    expect(() => resolveFeature("003", noSpecsDir)).toThrow(
      /Specs directory not found/,
    );
  });

  it("should not match files, only directories", () => {
    // Create a file that looks like a feature
    fs.writeFileSync(path.join(tmpDir, "specs", "099-fake-feature"), "");
    expect(() => resolveFeature("099", tmpDir)).toThrow(/Feature not found/);
  });

  it("should handle partial name match (not just prefix)", () => {
    // "build" should NOT match "002-build-server" — only prefix matching
    expect(() => resolveFeature("build", tmpDir)).toThrow(/Feature not found/);
  });
});
