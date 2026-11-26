/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import childProcess from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../cli.js";

describe("FR-008 / TR-019: CLI import purity and inference-free, secret-free initialization", () => {
  let tmpDir: string;
  let projectDir: string;
  let homeDir: string;
  let secretsDir: string;
  let registryDir: string;
  let trapBinDir: string;
  let trapLogPath: string;
  let oldCwd: string;

  beforeEach(() => {
    oldCwd = process.cwd();
    tmpDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-init-purity-")),
    );
    projectDir = path.join(tmpDir, "project");
    homeDir = path.join(tmpDir, "home");
    secretsDir = path.join(tmpDir, "secrets");
    registryDir = path.join(tmpDir, "registry");
    trapBinDir = path.join(tmpDir, "trap-bin");
    trapLogPath = path.join(tmpDir, "trap-invocations.log");

    for (const dir of [projectDir, homeDir, secretsDir, registryDir, trapBinDir]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "purity-fixture" }),
    );

    // Executable agent and OS-group traps fail loudly if ever executed during import or init.
    for (const binName of ["agy", "claude", "codex", "gemini", "getent"]) {
      const script = path.join(trapBinDir, binName);
      fs.writeFileSync(
        script,
        `#!/bin/sh\necho "${binName} $*" >> "${trapLogPath}"\nexit 99\n`,
        { mode: 0o755 },
      );
    }

    process.chdir(projectDir);
    vi.stubEnv("HOME", homeDir);
    vi.stubEnv("GWRK_HOME", path.join(homeDir, ".gwrk"));
    vi.stubEnv("GWRK_DIR", "");
    vi.stubEnv("GWRK_DB_PATH", "");
    vi.stubEnv("GWRK_RUNTIME_DIR", "");
    vi.stubEnv("GWRK_REGISTRY_PATH", registryDir);
    vi.stubEnv("GWRK_SECRETS_DIR", secretsDir);
    vi.stubEnv("GWRK_AUTH_MODE", "hosted");
    vi.stubEnv("GWRK_AUTH_PUBLIC_ORIGIN", "https://gwrk.gforge.ai");
    vi.stubEnv(
      "GWRK_AUTH_GOOGLE_CLIENT_ID",
      "purity-client.apps.googleusercontent.com",
    );
    vi.stubEnv(
      "GWRK_AUTH_GOOGLE_ALLOWLIST_FILE",
      path.join(secretsDir, "google-account-allowlist"),
    );
    vi.stubEnv(
      "GWRK_AUTH_CSRF_HMAC_FILE",
      path.join(secretsDir, "csrf-hmac-key"),
    );
    vi.stubEnv("SLACK_BOT_TOKEN", "");
    vi.stubEnv("SLACK_APP_TOKEN", "");
    vi.stubEnv("PATH", `${trapBinDir}:${process.env.PATH ?? "/usr/bin:/bin"}`);
  });

  afterEach(() => {
    process.chdir(oldCwd);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("TR-019: CLI and auth module imports perform zero auth secret reads, OS group lookups, or network calls", async () => {
    const authTouched: string[] = [];
    const recordIfAuth = (target: unknown) => {
      const text = String(target);
      if (
        text.includes(secretsDir) ||
        text.includes("google-account-allowlist") ||
        text.includes("csrf-hmac-key")
      ) {
        authTouched.push(text);
      }
    };

    const origOpen = fsp.open;
    vi.spyOn(fsp, "open").mockImplementation(((p: unknown, ...rest: unknown[]) => {
      recordIfAuth(p);
      return (origOpen as (...args: unknown[]) => unknown)(p, ...rest);
    }) as typeof fsp.open);

    const origReadFile = fsp.readFile;
    vi.spyOn(fsp, "readFile").mockImplementation(((
      p: unknown,
      ...rest: unknown[]
    ) => {
      recordIfAuth(p);
      return (origReadFile as (...args: unknown[]) => unknown)(p, ...rest);
    }) as typeof fsp.readFile);

    const origReadFileSync = fs.readFileSync;
    vi.spyOn(fs, "readFileSync").mockImplementation(((
      p: unknown,
      ...rest: unknown[]
    ) => {
      recordIfAuth(p);
      return (origReadFileSync as (...args: unknown[]) => unknown)(p, ...rest);
    }) as typeof fs.readFileSync);

    const execFileSpy = vi.spyOn(childProcess, "execFile");
    const spawnSpy = vi.spyOn(childProcess, "spawn");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected network call during import"));

    vi.resetModules();
    const [cliMod, serverMod, statusMod, initMod, factoryMod, clientMod] =
      await Promise.all([
        import("../cli.js"),
        import("./server.js"),
        import("./status.js"),
        import("./init.js"),
        import("../adapters/auth/hosted-auth-factory.js"),
        import("../adapters/auth/http-client-credential.js"),
      ]);

    cliMod.createCliProgram();
    serverMod.createServerCommand();
    statusMod.createStatusCommand();
    initMod.createInitCommand();
    expect(typeof factoryMod.createHostedAuthFactory).toBe("function");
    expect(typeof clientMod.createHttpClientCredentialProvider).toBe("function");

    expect(authTouched).toEqual([]);
    expect(execFileSpy).not.toHaveBeenCalled();
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(trapLogPath)).toBe(false);
  });

  it("TR-019: init retains inference-free and secret-free behavior under --non-interactive --server", async () => {
    const authTouched: string[] = [];
    const origOpen = fsp.open;
    vi.spyOn(fsp, "open").mockImplementation(((p: unknown, ...rest: unknown[]) => {
      if (String(p).includes(secretsDir)) authTouched.push(String(p));
      return (origOpen as (...args: unknown[]) => unknown)(p, ...rest);
    }) as typeof fsp.open);

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected network call during init"));

    let stdout = "";
    let stderr = "";
    const exitCode = await runCli(["init", "--non-interactive", "--server"], {
      stdout: (c) => {
        stdout += c;
      },
      stderr: (c) => {
        stderr += c;
      },
    });

    expect(exitCode, stderr).toBe(0);
    expect(fs.existsSync(path.join(projectDir, ".gwrkrc.json"))).toBe(true);

    // Zero agent binary executions, zero Google/network calls, zero auth secret reads.
    expect(fs.existsSync(trapLogPath)).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(authTouched).toEqual([]);

    // Init must never create a usable allowlist, HMAC key, or API credential.
    expect(fs.readdirSync(secretsDir)).toEqual([]);
    const tracked = JSON.parse(
      fs.readFileSync(path.join(projectDir, ".gwrkrc.json"), "utf8"),
    );
    expect(tracked.server?.auth).toBeUndefined();
    expect(stdout + stderr).not.toContain("gwrk_v1.");
  });
});
