import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { detectProfile } from "./profile-detector.js";
import { conditionPrompt } from "./prompt-conditioner.js";

describe("profile-detector", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects project type via core detection logic for pnpm monorepo", async () => {
    fs.writeFileSync(path.join(tmpDir, "pnpm-workspace.yaml"), "");
    fs.mkdirSync(path.join(tmpDir, "packages"));
    
    const profile = await detectProfile(tmpDir);
    expect(profile.type).toBe("pnpm-monorepo");
    expect(profile.stack.language).toBe("TypeScript");
    expect(profile.layout).toBe("monorepo");
  });

  it("detects project type via core detection logic for rust project", async () => {
    fs.writeFileSync(path.join(tmpDir, "Cargo.toml"), "");
    fs.mkdirSync(path.join(tmpDir, "src"));
    
    const profile = await detectProfile(tmpDir);
    expect(profile.type).toBe("rust");
    expect(profile.stack.language).toBe("Rust");
    expect(profile.layout).toBe("src-nested");
  });

  it("should perform tech stack and layout extraction for python project", async () => {
    fs.writeFileSync(path.join(tmpDir, "requirements.txt"), "");
    
    const profile = await detectProfile(tmpDir);
    expect(profile.type).toBe("python");
    expect(profile.stack.language).toBe("Python");
    expect(profile.stack.buildSystem).toBe("pip");
  });

  it("should perform tech stack and layout extraction for nodejs project with framework", async () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
      dependencies: {
        express: "^4.18.2"
      },
      devDependencies: {
        typescript: "^5.0.0"
      }
    }));
    
    const profile = await detectProfile(tmpDir);
    expect(profile.type).toBe("nodejs");
    expect(profile.stack.language).toBe("TypeScript");
    expect(profile.stack.framework).toBe("Express");
  });

  it("should detect gwrk-native", async () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
      name: "@gwrk/cli",
      version: "0.1.0",
    }));
    
    const profile = await detectProfile(tmpDir);
    expect(profile._isGwrk).toBe(true);
  });

  it("TR-034: gwrk-native prompt assembly regression snapshot", async () => {
    const profile = { type: "gwrk-native" };
    const prompt = "Gated: [type: gwrk-native]ADR-004[/type]";
    
    const result = conditionPrompt(prompt, profile);
    expect(result).toContain("ADR-004");
    expect(result).not.toContain("[type: gwrk-native]");
  });
});
