/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync, spawn } from "node:child_process";
import https from "node:https";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import promises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setImmediate, setTimeout as delay } from "node:timers/promises";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithOutputScope } from "../adapters/cli/output-scope.js";
import { repositoryGitEnv } from "../adapters/git/process-env.js";
import { resolveProjectId } from "../adapters/git/project-id.js";
import { createSqliteProjectRegistryAdapter } from "../adapters/sqlite/index.js";
import { openDatabase } from "../db/index.js";
import { AgentBackendRegistry } from "../plugins/agent-registry.js";
import * as pidUtils from "../server/pid.js";
import { createStatusCommand } from "./status.js";

const KEY = `gwrk_v1.status_key.${"a".repeat(43)}`;
const ORIGIN = "https://status.example.invalid";
const health = { daemonLiveness: "alive" };
const status = {
  server: {},
  system: {},
  dispatch: {},
  sandboxes: {},
  network: {},
};
const response = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = performance.now() + 5000;
  while (!predicate()) {
    if (performance.now() >= deadline)
      throw new Error("Fixture condition deadline exceeded");
    await delay(1);
  }
}

async function runStatus(args: string[], json = true) {
  let stdout = "";
  let stderr = "";
  const scope = {
    agentMode: false,
    exitCode: 0,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: (chunk: string) => {
      stderr += chunk;
    },
  };
  await runWithOutputScope(scope, async () => {
    const program = new Command("gwrk");
    program.addCommand(createStatusCommand());
    await program.parseAsync(["status", ...(json ? ["--json"] : []), ...args], {
      from: "user",
    });
  });
  return { stdout, stderr, exitCode: scope.exitCode };
}

describe("explicit status client credentials", () => {
  let root: string;
  let previous: string;
  let credential: string;
  let open: ReturnType<typeof vi.spyOn>;
  let fetchMock: ReturnType<typeof vi.fn>;
  const pair = () => [
    "--credential-file",
    credential,
    "--credential-origin",
    ORIGIN,
  ];
  const remote = () => ["--server-url", ORIGIN, ...pair()];

  beforeEach(() => {
    previous = process.cwd();
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "status-auth-")),
    );
    const repo = path.join(root, "repo");
    fs.mkdirSync(repo);
    execFileSync("git", ["init", "--template=", "--initial-branch=main"], {
      cwd: repo,
      stdio: "ignore",
      env: {
        ...repositoryGitEnv(repo),
        GIT_CONFIG_GLOBAL: os.devNull,
        GIT_CONFIG_NOSYSTEM: "1",
      },
    });
    process.chdir(repo);
    fs.writeFileSync(
      ".gwrkrc.json",
      JSON.stringify({ project: { name: "status-fixture" } }),
    );
    credential = path.join(root, "credential");
    fs.writeFileSync(credential, `${KEY}\n`, { mode: 0o600 });
    for (const [name, value] of Object.entries({
      GWRK_HOME: path.join(root, "home"),
      GWRK_DIR: "",
      GWRK_DB_PATH: "",
      GWRK_RUNTIME_DIR: "",
      GWRK_SERVER_URL: "",
    }))
      vi.stubEnv(name, value);
    vi.spyOn(pidUtils, "readPid").mockReturnValue(undefined);
    vi.spyOn(pidUtils, "isPidRunning").mockReturnValue(false);
    vi.spyOn(AgentBackendRegistry.prototype, "getBackends").mockReturnValue({});
    open = vi.spyOn(promises, "open");
    fetchMock = vi
      .fn()
      .mockImplementation(async (url: string) =>
        response(url.includes("/api/health") ? health : status),
      );
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    process.chdir(previous);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("preserves unconfigured local behavior without discovering environment keys", async () => {
    vi.stubEnv("GWRK_API_KEY", KEY);
    vi.stubEnv("GWRK_SERVER_API_KEY", KEY);
    expect((await runStatus([])).exitCode).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it.each(["file", "origin", "empty-file", "empty-origin"])(
    "denies %s before secret IO even without a configured server",
    async (kind) => {
      const args =
        kind === "file"
          ? ["--credential-file", credential]
          : kind === "origin"
            ? ["--credential-origin", ORIGIN]
            : [
                "--credential-file",
                kind === "empty-file" ? "" : credential,
                "--credential-origin",
                kind === "empty-origin" ? "" : ORIGIN,
              ];
      const result = await runStatus(args);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout).serverError).toBe(
        "Client credential profile is invalid",
      );
      expect(open).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    undefined,
    "http://status.example.invalid",
    "https://different.example.invalid",
  ])("does not derive target from credential origin: %s", async (url) => {
    const result = await runStatus([
      ...(url ? ["--server-url", url] : []),
      ...pair(),
    ]);
    expect(result.exitCode).toBe(1);
    expect(open).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("denies partial credentials in text without probing unrelated agent providers", async () => {
    const result = await runStatus(["--credential-file", credential], false);
    expect(result.exitCode).toBe(1);
    expect(open).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(AgentBackendRegistry.prototype.getBackends).not.toHaveBeenCalled();
  });

  it("ignores credential fields from all config layers and environment tokens", async () => {
    const fields = {
      credentialFile: credential,
      credentialOrigin: ORIGIN,
      apiKey: KEY,
    };
    fs.writeFileSync(
      ".gwrkrc.json",
      JSON.stringify({ project: { name: "status-fixture" }, ...fields }),
    );
    fs.writeFileSync(".gwrkrc.local.json", JSON.stringify(fields));
    fs.mkdirSync(path.join(root, "home"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "home", "config.json"),
      JSON.stringify(fields),
    );
    vi.stubEnv("GWRK_SERVER_URL", ORIGIN);
    vi.stubEnv("GWRK_API_KEY", KEY);
    vi.stubEnv("GWRK_SERVER_API_KEY", KEY);
    vi.stubEnv("ANTHROPIC_API_KEY", KEY);
    expect((await runStatus([])).exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(open).not.toHaveBeenCalled();
    for (const [, options] of fetchMock.mock.calls)
      expect(options.headers).toBeUndefined();
  });

  it("scopes both authenticated probes to an explicitly selected enrolled project", async () => {
    execFileSync(
      "git",
      ["remote", "add", "origin", "https://github.com/org/selected.git"],
      { cwd: process.cwd(), env: repositoryGitEnv(process.cwd()) },
    );
    const selectedId = resolveProjectId(process.cwd());
    const db = openDatabase();
    try {
      createSqliteProjectRegistryAdapter({ db }).enrollProject({
        projectId: selectedId,
        slug: "selected",
        name: "Selected Project",
        repoSlug: "org/selected",
        trunkBranch: "main",
        localRoot: process.cwd(),
        mirrorPath: null,
        runnerPolicy: { allowedKinds: ["local"] },
        slack: null,
        legacyProjectIds: [],
        createdAt: "2026-11-24T00:00:00.000Z",
        updatedAt: "2026-11-24T00:00:00.000Z",
      });
    } finally {
      db.close();
    }
    const result = await runStatus(["--project", "selected", ...remote()]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).project.projectId).toBe(selectedId);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url] of fetchMock.mock.calls)
      expect(new URL(url).searchParams.get("projectId")).toBe(selectedId);
  });

  it("resolves each protected URL and scopes both probes to the selected project", async () => {
    vi.stubEnv("GWRK_SERVER_URL", "https://ignored.example.invalid");
    const result = await runStatus(remote());
    expect(result.exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledTimes(2);
    const projectId = JSON.parse(result.stdout).project.projectId;
    for (const [url, options] of fetchMock.mock.calls) {
      const parsed = new URL(url);
      expect(parsed.origin).toBe(ORIGIN);
      expect(parsed.searchParams.get("projectId")).toBe(projectId);
      expect(options.headers).toEqual({ Authorization: `Bearer ${KEY}` });
      expect(options.redirect).toBe("manual");
    }
    expect(fetchMock.mock.calls[0][1].signal).toBe(
      fetchMock.mock.calls[1][1].signal,
    );
  });

  it("checks environment-selected actual URL independently", async () => {
    vi.stubEnv("GWRK_SERVER_URL", "https://different.example.invalid");
    expect((await runStatus(pair())).exitCode).toBe(1);
    expect(open).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reloads file protections before status after health", async () => {
    fetchMock.mockImplementation(async () => {
      fs.chmodSync(credential, 0o644);
      return response(health);
    });
    expect((await runStatus(remote())).exitCode).toBe(1);
    expect(open).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([301, 302, 303, 307, 308])(
    "denies health redirect %s without following or echoing Location",
    async (code) => {
      const cancel = vi.fn().mockResolvedValue(undefined);
      fetchMock.mockResolvedValue({
        ok: false,
        status: code,
        headers: new Headers({
          Location: `https://leak.invalid/?secret=${KEY}`,
        }),
        body: { cancel },
      });
      const result = await runStatus(remote());
      expect(result.exitCode).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(cancel).toHaveBeenCalledOnce();
      expect(result.stdout + result.stderr).not.toContain(KEY);
      expect(result.stdout + result.stderr).not.toContain("leak.invalid");
    },
  );

  it("denies status redirects after an authenticated health response", async () => {
    fetchMock.mockResolvedValueOnce(response(health)).mockResolvedValueOnce({
      ok: false,
      status: 302,
      body: { cancel: vi.fn().mockResolvedValue(undefined) },
    });
    expect((await runStatus(remote())).exitCode).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].redirect).toBe("manual");
  });

  it.each([true, false])(
    "redacts thrown transport errors in JSON/text/hints (json=%s)",
    async (json) => {
      fetchMock.mockRejectedValue(
        new Error(
          `https://userinfo-canary:${KEY}@private.invalid/?query-canary=${KEY}`,
        ),
      );
      const result = await runStatus(remote(), json);
      expect(result.exitCode).toBe(1);
      expect(result.stdout + result.stderr).not.toMatch(
        /userinfo-canary|query-canary|private.invalid/,
      );
      expect(result.stdout + result.stderr).not.toContain(KEY);
    },
  );

  it.each([true, false])(
    "redacts configured URL userinfo and query (json=%s)",
    async (json) => {
      const result = await runStatus(
        [
          "--server-url",
          `https://userinfo-canary:${KEY}@status.example.invalid/?query-canary=${KEY}`,
          ...pair(),
        ],
        json,
      );
      expect(result.exitCode).toBe(1);
      expect(open).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.stdout + result.stderr).not.toMatch(
        /userinfo-canary|query-canary/,
      );
      expect(result.stdout + result.stderr).not.toContain(KEY);
    },
  );

  it("bounds the complete health/status sequence to one ten-second deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fetchMock.mockImplementation(
      (url: string) =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve(response(url.includes("health") ? health : status)),
            6000,
          ),
        ),
    );
    let settled = false;
    const pending = runStatus(remote()).then((result) => {
      settled = true;
      return result;
    });
    await waitFor(() => fetchMock.mock.calls.length > 0);
    await vi.advanceTimersByTimeAsync(6000);
    await waitFor(() => fetchMock.mock.calls.length === 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4000);
    for (let i = 0; i < 20 && !settled; i++) await setImmediate();
    const settledAtDeadline = settled;
    await vi.advanceTimersByTimeAsync(6000);
    const result = await pending;
    expect(settledAtDeadline).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(fetchMock.mock.calls[0][1].signal).toBe(
      fetchMock.mock.calls[1][1].signal,
    );
  });
  it("bounds a stalled JSON body and cancels it at the deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const cancel = vi.fn().mockResolvedValue(undefined);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => new Promise(() => {}),
      body: { cancel },
    });
    const pending = runStatus(remote());
    await waitFor(() => fetchMock.mock.calls.length > 0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await pending).exitCode).toBe(1);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("cancels a late transport body without launching status", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const cancel = vi.fn().mockResolvedValue(undefined);
    let complete!: (value: unknown) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const pending = runStatus(remote());
    await waitFor(() => fetchMock.mock.calls.length > 0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await pending).exitCode).toBe(1);
    complete({ ...response(health), body: { cancel } });
    await setImmediate();
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("authenticates over trusted TLS and refuses a real redirect transport", async () => {
    const cert = path.join(root, "fixture-ca.pem");
    const key = path.join(root, "fixture-key.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
        "-keyout",
        key,
        "-out",
        cert,
      ],
      { stdio: "ignore", timeout: 10_000 },
    );
    const calls: { url: string; authorization?: string }[] = [];
    let redirect = false;
    let redirectedCalls = 0;
    const redirectTarget = https.createServer(
      { key: fs.readFileSync(key), cert: fs.readFileSync(cert) },
      (_req, reply) => {
        redirectedCalls++;
        reply.end("unexpected");
      },
    );
    const server = https.createServer(
      { key: fs.readFileSync(key), cert: fs.readFileSync(cert) },
      (request, reply) => {
        calls.push({
          url: request.url ?? "",
          authorization: request.headers.authorization,
        });
        if (redirect) {
          reply.writeHead(302, { Location: redirectOrigin });
          reply.end();
          return;
        }
        reply.setHeader("content-type", "application/json");
        reply.end(
          JSON.stringify(
            request.url?.startsWith("/api/health") ? health : status,
          ),
        );
      },
    );
    let redirectOrigin = "";
    const listen = (target: https.Server) =>
      new Promise<number>((resolve, reject) => {
        target.once("error", reject);
        target.listen(0, "127.0.0.1", () => {
          const address = target.address();
          if (!address || typeof address === "string")
            reject(new Error("No fixture address"));
          else resolve(address.port);
        });
      });
    const cli = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
    const invoke = (origin: string) =>
      new Promise<{ code: number | null; stdout: string; stderr: string }>(
        (resolve, reject) => {
          const child = spawn(
            process.execPath,
            [
              cli,
              "status",
              "--json",
              "--server-url",
              origin,
              "--credential-file",
              credential,
              "--credential-origin",
              origin,
            ],
            {
              cwd: process.cwd(),
              env: {
                PATH: process.env.PATH,
                HOME: root,
                GWRK_HOME: path.join(root, "child-home"),
                GWRK_DIR: "",
                GWRK_DB_PATH: "",
                GWRK_RUNTIME_DIR: "",
                GWRK_SERVER_URL: "",
                NODE_EXTRA_CA_CERTS: cert,
                GIT_CONFIG_GLOBAL: os.devNull,
                GIT_CONFIG_NOSYSTEM: "1",
              },
              stdio: ["ignore", "pipe", "pipe"],
            },
          );
          let stdout = "";
          let stderr = "";
          const timer = setTimeout(() => {
            child.kill("SIGKILL");
            reject(new Error("Fixture child deadline exceeded"));
          }, 15_000);
          child.stdout.on("data", (data) => {
            stdout += data;
            if (stdout.length > 65536) child.kill("SIGKILL");
          });
          child.stderr.on("data", (data) => {
            stderr += data;
            if (stderr.length > 65536) child.kill("SIGKILL");
          });
          child.once("error", (error) => {
            clearTimeout(timer);
            reject(error);
          });
          child.once("close", (code) => {
            clearTimeout(timer);
            resolve({ code, stdout, stderr });
          });
        },
      );
    try {
      redirectOrigin = `https://127.0.0.1:${await listen(redirectTarget)}`;
      const origin = `https://127.0.0.1:${await listen(server)}`;
      const success = await invoke(origin);
      expect(success.code).toBe(0);
      expect(calls).toHaveLength(2);
      for (const request of calls) {
        expect(request.authorization).toBe(`Bearer ${KEY}`);
        expect(new URL(request.url, origin).searchParams.get("projectId")).toBe(
          JSON.parse(success.stdout).project.projectId,
        );
      }
      calls.length = 0;
      redirect = true;
      const denial = await invoke(origin);
      expect(denial.code).toBe(1);
      expect(calls).toHaveLength(1);
      expect(redirectedCalls).toBe(0);
      expect(denial.stdout + denial.stderr).not.toContain(KEY);
    } finally {
      for (const target of [server, redirectTarget]) {
        target.closeAllConnections();
        if (target.listening)
          await new Promise<void>((resolve) => target.close(() => resolve()));
      }
    }
  }, 30_000);

  it("rejects invalid and malformed global auth overlay in registry fallback without echoing secrets", async () => {
    const canary = "CANARY_STATUS_AUTH_SECRET";
    const emptyDir = path.join(root, "no-config-cwd");
    fs.mkdirSync(emptyDir, { recursive: true });
    const enrolledRoot = process.cwd();
    execFileSync(
      "git",
      ["remote", "add", "origin", "https://github.com/org/fallback.git"],
      { cwd: enrolledRoot, env: repositoryGitEnv(enrolledRoot) },
    );
    const selectedId = resolveProjectId(enrolledRoot);
    const db = openDatabase();
    try {
      createSqliteProjectRegistryAdapter({ db }).enrollProject({
        projectId: selectedId,
        slug: "fallback-proj",
        name: "Fallback Project",
        repoSlug: "org/fallback",
        trunkBranch: "main",
        localRoot: enrolledRoot,
        mirrorPath: null,
        runnerPolicy: { allowedKinds: ["local"] },
        slack: null,
        legacyProjectIds: [],
        createdAt: "2026-11-24T00:00:00.000Z",
        updatedAt: "2026-11-24T00:00:00.000Z",
      });
    } finally {
      db.close();
    }
    fs.rmSync(path.join(enrolledRoot, ".gwrkrc.json"));
    process.chdir(emptyDir);

    const homeDir = path.join(root, "home");
    fs.mkdirSync(homeDir, { recursive: true });

    // 1. Invalid typed auth in global config must fail without echoing invalid value.
    fs.writeFileSync(
      path.join(homeDir, "config.json"),
      JSON.stringify({
        server: {
          host: "127.0.0.1",
          port: 18790,
          auth: { mode: canary },
        },
      }),
    );
    const invalidRes = await runStatus(["--project", "fallback-proj"]);
    expect(invalidRes.exitCode).toBe(1);
    expect(invalidRes.stdout + invalidRes.stderr).not.toContain(canary);
    expect(invalidRes.stderr).toContain("Authentication configuration denied");

    // 2. Malformed JSON containing auth in global config must fail closed instead of falling back.
    fs.writeFileSync(
      path.join(homeDir, "config.json"),
      `{"server":{"auth":{"mode":"hosted","secret":"${canary}"`,
    );
    const malformedRes = await runStatus(["--project", "fallback-proj"]);
    expect(malformedRes.exitCode).toBe(1);
    expect(malformedRes.stdout + malformedRes.stderr).not.toContain(canary);
  });
});
