import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { activatePhaseTests } from "./test-activator.js";
import fs from "node:fs";
import path from "node:path";

describe("test-activator", () => {
  const cwd = "/tmp/test-workspace";

  beforeEach(() => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue("");
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("activates tests tagged with matching @phase", () => {
    const content = `/**
 * @phase 12
 * @status red
 */
import { describe, it } from 'vitest';

describe.skip('Test suite', () => {
  it.skip('should work', () => {});
  it.skip('should also work', () => {});
});
`;
    vi.mocked(fs.readFileSync).mockReturnValue(content);

    const result = activatePhaseTests(cwd, "phase-12", ["src/test.test.ts"]);

    expect(result.activated).toBe(1);
    expect(result.files).toEqual(["src/test.test.ts"]);

    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain("describe(");
    expect(written).not.toContain("describe.skip(");
    expect(written).toContain("it(");
    expect(written).not.toContain("it.skip(");
    expect(written).toContain("@status active");
    expect(written).not.toContain("@status red");
  });

  it("does not activate tests tagged with a different @phase", () => {
    const content = `/**
 * @phase 13
 * @status red
 */
describe.skip('Other phase', () => {
  it.skip('should not activate', () => {});
});
`;
    vi.mocked(fs.readFileSync).mockReturnValue(content);

    const result = activatePhaseTests(cwd, "phase-12", ["src/test.test.ts"]);

    expect(result.activated).toBe(0);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("is idempotent — no-ops on already active tests", () => {
    const content = `/**
 * @phase 12
 * @status active
 */
describe('Already active', () => {
  it('already runs', () => {});
});
`;
    vi.mocked(fs.readFileSync).mockReturnValue(content);

    const result = activatePhaseTests(cwd, "phase-12", ["src/test.test.ts"]);

    expect(result.activated).toBe(0);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("skips non-existent files", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = activatePhaseTests(cwd, "phase-12", ["src/missing.test.ts"]);

    expect(result.activated).toBe(0);
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it("handles integer phase matching (phase-12 matches @phase 12)", () => {
    const content = `/**
 * @phase 12
 * @status red
 */
describe.skip('Suite', () => {
  it.skip('test', () => {});
});
`;
    vi.mocked(fs.readFileSync).mockReturnValue(content);

    const result = activatePhaseTests(cwd, "phase-012", ["src/test.test.ts"]);

    // "012" !== "12" as string, but parseInt("012") === 12
    expect(result.activated).toBe(1);
  });
});
