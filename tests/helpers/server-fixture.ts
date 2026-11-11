/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { devNull, tmpdir } from "node:os";
import { basename, join } from "node:path";
import type Database from "better-sqlite3";
import fastify, { type FastifyInstance } from "fastify";
import { repositoryGitEnv } from "../../src/adapters/git/process-env.js";
import { openDatabase } from "../../src/db/index.js";
import { registerProject } from "../../src/db/runs.js";
import { DispatchQueue } from "../../src/server/dispatch.js";
import { ScopedSandboxManager, startServer } from "../../src/server/index.js";
import { LifecycleMonitor } from "../../src/server/lifecycle.js";
import { SystemMonitor } from "../../src/server/monitor.js";
import { NetworkMonitor } from "../../src/server/network.js";
import { dispatchRoutes } from "../../src/server/routes/dispatch.js";
import { healthRoutes } from "../../src/server/routes/health.js";
import { notifyRoutes } from "../../src/server/routes/notify.js";
import { statusRoutes } from "../../src/server/routes/status.js";
import type { DispatchRecord } from "../../src/server/types.js";
import { GwrkConfigSchema } from "../../src/utils/config.js";

export interface ServerFixture {
  app: FastifyInstance;
  projectRoot: string;
  projectId: string;
  pidPath: string;
  db: Database.Database;
  journal(): DispatchRecord[];
  close(): Promise<void>;
}

interface FixtureOptions {
  routes?: ("dispatch" | "health" | "notify" | "status")[];
  pauseDispatch?: boolean;
}

function fixtureGitEnv(root: string): NodeJS.ProcessEnv {
  return {
    ...repositoryGitEnv(root),
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_EDITOR: "true",
    EDITOR: "true",
    GIT_TERMINAL_PROMPT: "0",
  };
}

export function fixtureGit(root: string, ...args: string[]): string {
  const options = {
    cwd: root,
    encoding: "utf8" as const,
    stdio: ["ignore", "pipe", "pipe"] as ("ignore" | "pipe")[],
    timeout: 5_000,
  };
  return execFileSync("git", args, {
    ...options,
    env: fixtureGitEnv(root),
  }).trim();
}

export async function createServerFixture(
  mode: "routes" | "listen",
  options: FixtureOptions = {},
): Promise<ServerFixture> {
  const projectRoot = mkdtempSync(join(realpathSync(tmpdir()), "gwrk-server-"));
  const projectId = basename(projectRoot);
  const stateDir = join(projectRoot, ".gwrk");
  const pidPath = join(stateDir, "server.pid");
  const journalPath = join(stateDir, "dispatches.jsonl");
  let app: FastifyInstance | undefined;
  let db: Database.Database | undefined;
  let closing: Promise<void> | undefined;
  function close() {
    closing ??= (async () => {
      try {
        await app?.close();
      } finally {
        try {
          db?.close();
        } finally {
          rmSync(projectRoot, { recursive: true, force: true });
        }
      }
    })();
    return closing;
  }

  try {
    if (mode === "listen" || options.routes?.includes("dispatch")) {
      fixtureGit(
        projectRoot,
        "init",
        "--template=",
        "--initial-branch=develop",
      );
      fixtureGit(
        projectRoot,
        "config",
        "--local",
        "core.hooksPath",
        join(projectRoot, "no-hooks"),
      );
      fixtureGit(
        projectRoot,
        "-c",
        "user.name=Gwrk Test",
        "-c",
        "user.email=gwrk-test@example.invalid",
        "commit",
        "--author=Gwrk Test <gwrk-test@example.invalid>",
        "--no-gpg-sign",
        "--allow-empty",
        "-m",
        "Initialize fixture",
      );
    }

    db = openDatabase({ dbPath: join(stateDir, "gwrk.db") });
    registerProject({ id: projectId, name: projectId, path: projectRoot }, db);
    const config = GwrkConfigSchema.parse({
      project: { name: projectId },
      agents: { implement: "gemini" },
      server: {
        host: "127.0.0.1",
        port: 0,
        githubWebhookSecret: "fixture-secret",
        heartbeatIntervalMs: 100,
        networkCheckIntervalMs: 100,
      },
      parallelism: {
        local: { maxCpu: 100, maxMem: 100, minDiskGb: 1, maxClones: 2 },
      },
    });
    const ledger = { db, projectId };
    const gitEnv = () => fixtureGitEnv(projectRoot);
    const sandbox = new ScopedSandboxManager(projectRoot, gitEnv);

    if (mode === "listen") {
      app = await startServer(config, {
        handleSignals: false,
        projectRoot,
        ledger,
        sandbox,
        gitEnv,
        pid: {
          writePid(pid) {
            mkdirSync(stateDir, { recursive: true });
            writeFileSync(pidPath, String(pid), { flag: "wx" });
          },
          removePid() {
            if (
              existsSync(pidPath) &&
              readFileSync(pidPath, "utf8") === String(process.pid)
            ) {
              rmSync(pidPath, { force: true });
            }
          },
        },
      });
    } else {
      app = fastify();
      const monitor = new SystemMonitor(config);
      const queue = new DispatchQueue(
        config,
        monitor,
        sandbox,
        projectRoot,
        ledger,
      );
      const lifecycle = new LifecycleMonitor(config);
      lifecycle.setStatus("ready");
      const network = new NetworkMonitor(config);

      if (options.pauseDispatch) queue.pause();
      app.addHook("onClose", () => queue.close());

      const routes = options.routes ?? [];
      if (routes.includes("health"))
        await healthRoutes(app, lifecycle, network, sandbox);
      if (routes.includes("status"))
        await statusRoutes(app, monitor, queue, sandbox, lifecycle, network);
      if (routes.includes("dispatch")) await dispatchRoutes(app, queue);
      if (routes.includes("notify")) await notifyRoutes(app);
      await app.ready();
    }

    return {
      app,
      db,
      projectRoot,
      projectId,
      pidPath,
      close,
      journal() {
        if (!existsSync(journalPath)) return [];
        return readFileSync(journalPath, "utf8")
          .trimEnd()
          .split("\n")
          .map((line) => JSON.parse(line) as DispatchRecord);
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
