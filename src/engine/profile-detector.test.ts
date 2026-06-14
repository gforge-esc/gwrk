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

  it("detects polyglot-monorepo when multiple language markers are present", async () => {
    // EnergyWork scenario: Python + JS + Go
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
      dependencies: { express: "^4.18.2" },
      devDependencies: { typescript: "^5.0.0" }
    }));
    fs.writeFileSync(path.join(tmpDir, "pyproject.toml"), "");
    fs.writeFileSync(path.join(tmpDir, "go.mod"), "");
    
    const profile = await detectProfile(tmpDir);
    expect(profile.type).toBe("polyglot-monorepo");
    expect(profile.stack?.languages).toEqual(["TypeScript", "Python", "Go"]);
    expect(profile.stack?.language).toBe("TypeScript"); // primary (backwards compat)
    expect(profile.layout).toBe("monorepo");
  });

  it("detects Go project from go.mod", async () => {
    fs.writeFileSync(path.join(tmpDir, "go.mod"), "module example.com/app");
    
    const profile = await detectProfile(tmpDir);
    expect(profile.type).toBe("go");
    expect(profile.stack?.language).toBe("Go");
    expect(profile.stack?.buildSystem).toBe("go");
  });

  it("detects two-language polyglot (Rust + Go)", async () => {
    fs.writeFileSync(path.join(tmpDir, "Cargo.toml"), "");
    fs.writeFileSync(path.join(tmpDir, "go.mod"), "");
    
    const profile = await detectProfile(tmpDir);
    expect(profile.type).toBe("polyglot-monorepo");
    expect(profile.stack?.languages).toEqual(["Rust", "Go"]);
    expect(profile.layout).toBe("monorepo");
  });

  it("single language still sets languages as undefined", async () => {
    fs.writeFileSync(path.join(tmpDir, "Cargo.toml"), "");
    
    const profile = await detectProfile(tmpDir);
    expect(profile.type).toBe("rust");
    expect(profile.stack?.languages).toBeUndefined;
  });

  it("polyglot profile emits <languages> XML in prompt conditioning", async () => {
    const profile = {
      type: "polyglot-monorepo",
      stack: {
        language: "TypeScript",
        languages: ["TypeScript", "Python", "Go"],
      },
      layout: "monorepo",
    };
    
    const result = conditionPrompt("Test", profile);
    expect(result).toContain("<languages>");
    expect(result).toContain("<lang>TypeScript</lang>");
    expect(result).toContain("<lang>Python</lang>");
    expect(result).toContain("<lang>Go</lang>");
    expect(result).toContain('type="polyglot-monorepo"');
  });
});

describe("FR-002: Workspace Detection via CWD (020-polyglot-monorepo)", () => {
  it("US-002: detects active workspace profile based on cwd in polyglot monorepo", async () => {
    const pd = await import("./profile-detector.js" as any);
    const mockConfig = {
      project: { name: "test" },
      workspaces: {
        "apps/web": { stack: { language: "typescript" } },
        "crates/backend": { stack: { language: "rust" } }
      }
    };
    
    // Typecast to any because resolveWorkspaceProfile is part of the implementation needed for tests to pass eventually
    const resolveWorkspaceProfile = (pd as any).resolveWorkspaceProfile;
    
    expect(resolveWorkspaceProfile).toBeDefined();

    const webProfile = resolveWorkspaceProfile("/path/to/repo/apps/web", "/path/to/repo", mockConfig);
    expect(webProfile?.stack?.language).toBe("typescript");

    const backendProfile = resolveWorkspaceProfile("/path/to/repo/crates/backend/src", "/path/to/repo", mockConfig);
    expect(backendProfile?.stack?.language).toBe("rust");
    
    const fallbackProfile = resolveWorkspaceProfile("/path/to/repo/unknown", "/path/to/repo", mockConfig);
    expect(fallbackProfile).toBeUndefined();
  });
});
