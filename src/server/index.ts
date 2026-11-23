/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import fastify, { type FastifyRequest } from "fastify";
import { QuotaProber } from "../adapters/agents/quota-prober.js";
import { loadRegistry } from "../adapters/agents/registry-loader.js";
import {
  exitCli,
  logCliOutput,
  warnCli,
} from "../adapters/cli/output-scope.js";
import { gwrkRuntimeDir, usesHostedRuntime } from "../adapters/config/paths.js";
import { createGitVcsAdapter } from "../adapters/git/index.js";
import { repositoryGitEnv } from "../adapters/git/process-env.js";
import { createSlackNotificationAdapter } from "../adapters/notifications/index.js";
import {
  acquireInstanceLock,
  acquireLedgerLock,
} from "../adapters/server/instance-lock.js";
import { createSqliteProjectRegistryAdapter } from "../adapters/sqlite/index.js";
import {
  type ProjectRoutingService,
  createProjectRoutingService,
} from "../application/project-routing/index.js";
import { closeDb, getDbPath } from "../db/index.js";
import { PENDING_LEDGER_RESTORE } from "../domain/ledger-backup.js";
import type { AllowedRunnerKind } from "../domain/project-registry.js";
import { isPrivateRunnerBind } from "../domain/release-packaging.js";
import type { NotificationPort } from "../ports/notification-port.js";
import type { InstanceLockHandle } from "../ports/release-ops-port.js";
import type { ProjectRegistryPort } from "../ports/store-port.js";
import type { VcsPort } from "../ports/vcs-port.js";
import type { AgentBackendId, GwrkConfig } from "../utils/config.js";
import { BackendSelector } from "./backend-selector.js";
import { type DispatchLedgerScope, DispatchQueue } from "./dispatch.js";
import { GitManager } from "./git-manager.js";
import { githubWebhookPlugin } from "./github.js";
import { HarvestWatcher } from "./harvest-watcher.js";
import { PlanHeartbeat } from "./heartbeat.js";
import { LifecycleMonitor } from "./lifecycle.js";
import { SystemMonitor } from "./monitor.js";
import { NetworkMonitor } from "./network.js";
import { removePid, writePid } from "./pid.js";
import { dispatchRoutes } from "./routes/dispatch.js";
import { healthRoutes } from "./routes/health.js";
import { notifyRoutes } from "./routes/notify.js";
import { statusRoutes } from "./routes/status.js";
import { SandboxManager } from "./sandbox.js";
import { getSlackApp, startSlackApp, stopSlackApp } from "./slack.js";
import { startTelegramBot } from "./telegram.js";
import type { SandboxInfo } from "./types.js";

export { BackendSelector } from "./backend-selector.js";
export { QuotaProber } from "../adapters/agents/quota-prober.js";
export { loadRegistry } from "../adapters/agents/registry-loader.js";

let backendSelector: BackendSelector | undefined;
export function getBackendSelector(
  projectRoot: string = process.cwd(),
): BackendSelector {
  if (!backendSelector) {
    const registry = loadRegistry(projectRoot);
    const prober = new QuotaProber(projectRoot);
    backendSelector = new BackendSelector(registry, prober);
  }
  return backendSelector;
}

export interface ServerPidScope {
  writePid(pid: number): void;
  removePid(): void;
}

export interface ServerStartOptions {
  handleSignals?: boolean;
  projectRoot?: string;
  pid?: ServerPidScope;
  ledger?: DispatchLedgerScope;
  sandbox?: SandboxManager;
  gitEnv?: () => NodeJS.ProcessEnv;
  registry?: ProjectRegistryPort;
  routingService?: ProjectRoutingService;
  vcs?: VcsPort;
  notifier?: NotificationPort;
  transport?: "trusted_local" | "hosted";
  localDefaultProjectId?: string;
  resolvePrincipal?: (request: FastifyRequest) =>
    | {
        principalType: "cli_token" | "google_sub";
        principalId: string;
      }
    | undefined;
  runnerKind?: AllowedRunnerKind;
  useProjectRegistry?: boolean;
}

function isLoopbackListenHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

export class ScopedSandboxManager extends SandboxManager {
  private readonly root: string;
  private readonly gitEnv: () => NodeJS.ProcessEnv;
  private readonly childManagers = new Map<string, ScopedSandboxManager>();
  private readonly workDirRoots = new Map<string, string>();

  constructor(
    root: string,
    private readonly customGitEnv?: () => NodeJS.ProcessEnv,
    private readonly registry?: ProjectRegistryPort,
  ) {
    const normalizedRoot = resolve(root);
    super(normalizedRoot);
    this.root = normalizedRoot;
    this.gitEnv = customGitEnv ?? (() => repositoryGitEnv(normalizedRoot));
  }

  protected override gitOptions() {
    return { env: this.gitEnv() };
  }

  private managerForRoot(targetRoot: string): ScopedSandboxManager {
    const normalized = resolve(targetRoot);
    if (normalized === this.root) return this;
    let manager = this.childManagers.get(normalized);
    if (!manager) {
      manager = new ScopedSandboxManager(normalized, this.customGitEnv);
      this.childManagers.set(normalized, manager);
    }
    return manager;
  }

  private knownRoots(): string[] {
    const roots = new Set<string>([this.root, ...this.childManagers.keys()]);
    if (this.registry) {
      for (const project of this.registry.listProjects()) {
        const checkoutRoot = project.mirrorPath ?? project.localRoot;
        if (checkoutRoot) {
          roots.add(resolve(checkoutRoot));
        }
      }
    }
    return Array.from(roots);
  }

  private resolveWorkDirRoot(workDir: string): string {
    const normalizedWorkDir = resolve(workDir);
    const tracked = this.workDirRoots.get(normalizedWorkDir);
    if (tracked) return tracked;
    const sandboxesDir = dirname(normalizedWorkDir);
    const runsDir = dirname(sandboxesDir);
    if (
      basename(sandboxesDir) === "sandboxes" &&
      basename(runsDir) === ".runs"
    ) {
      return dirname(runsDir);
    }
    return this.root;
  }

  private pruneOwnRoot(): void {
    const hasGitRepo =
      existsSync(join(this.root, ".git")) ||
      (existsSync(join(this.root, "HEAD")) &&
        existsSync(join(this.root, "objects")));
    if (!hasGitRepo) return;
    execFileSync("git", ["worktree", "prune"], {
      cwd: this.root,
      ...this.gitOptions(),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5_000,
    });
  }

  private listOwnSandboxes(): SandboxInfo[] {
    return this.listRecords()
      .filter(({ orphaned }) => !orphaned)
      .map(
        ({ workDir, featureId, createdAt }) =>
          ({
            workDir,
            featureId,
            taskId: basename(workDir).split("-").at(-2) ?? "",
            status: "running",
            startedAt: createdAt,
          }) as SandboxInfo,
      );
  }

  override async createSandbox(
    opts: Parameters<SandboxManager["createSandbox"]>[0],
  ): Promise<string> {
    const targetRoot = resolve(opts.projectRoot || this.root);
    const manager = this.managerForRoot(targetRoot);
    const workDir =
      manager === this
        ? await super.createSandbox({ ...opts, projectRoot: targetRoot })
        : await manager.createSandbox({ ...opts, projectRoot: targetRoot });
    this.workDirRoots.set(resolve(workDir), targetRoot);
    return workDir;
  }

  override async destroySandbox(
    workDir: string,
    featureId: string,
    options?: Parameters<SandboxManager["destroySandbox"]>[2],
  ): Promise<void> {
    const normalizedWorkDir = resolve(workDir);
    const targetRoot = this.resolveWorkDirRoot(normalizedWorkDir);
    const manager = this.managerForRoot(targetRoot);
    try {
      if (manager === this) {
        await super.destroySandbox(workDir, featureId, options);
      } else {
        await manager.destroySandbox(workDir, featureId, options);
      }
    } finally {
      this.workDirRoots.delete(normalizedWorkDir);
    }
  }

  override async pruneSandboxes(): Promise<void> {
    for (const targetRoot of this.knownRoots()) {
      const manager = this.managerForRoot(targetRoot);
      if (manager === this) {
        this.pruneOwnRoot();
      } else {
        await manager.pruneSandboxes();
      }
    }
  }

  override async listSandboxes(): Promise<SandboxInfo[]> {
    const results: SandboxInfo[] = [];
    const seen = new Set<string>();
    for (const targetRoot of this.knownRoots()) {
      const manager = this.managerForRoot(targetRoot);
      const items =
        manager === this
          ? this.listOwnSandboxes()
          : await manager.listSandboxes();
      for (const item of items) {
        const key = resolve(item.workDir);
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(item);
      }
    }
    return results;
  }
}

let slackInUse = false;

export async function startServer(
  config: GwrkConfig,
  options: ServerStartOptions = { handleSignals: true },
) {
  const hosted = usesHostedRuntime();
  if (hosted && !isPrivateRunnerBind(config.server.host)) {
    throw new Error("The hosted runner requires a private listen address.");
  }
  const instanceLock = hosted
    ? acquireInstanceLock(gwrkRuntimeDir(), process.pid)
    : undefined;
  let ledgerLock: InstanceLockHandle | undefined;
  try {
    if (instanceLock) {
      const ledgerPath = options.ledger?.db.name ?? getDbPath();
      ledgerLock = acquireLedgerLock(ledgerPath, process.pid);
      if (existsSync(join(dirname(ledgerPath), PENDING_LEDGER_RESTORE))) {
        throw new Error(
          "An unfinished ledger restore blocks startup. Retry 'gwrk db restore' with the original backup.",
        );
      }
    }
    return await startLockedServer(
      config,
      options,
      instanceLock,
      ledgerLock,
      hosted,
      hosted ? process.env.GWRK_APPROVED_AGENT : undefined,
    );
  } catch (error) {
    ledgerLock?.release();
    instanceLock?.release();
    throw error;
  }
}

async function startLockedServer(
  config: GwrkConfig,
  options: ServerStartOptions,
  instanceLock: InstanceLockHandle | undefined,
  ledgerLock: InstanceLockHandle | undefined,
  hosted: boolean,
  approvedBackend: AgentBackendId | undefined,
) {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const canonicalRoot = existsSync(projectRoot)
    ? realpathSync(projectRoot)
    : projectRoot;
  const gitEnv =
    options.gitEnv ??
    (options.projectRoot !== undefined || options.ledger
      ? () => repositoryGitEnv(projectRoot)
      : undefined);
  const pid = options.pid ?? { writePid, removePid };
  const server = fastify({
    logger: true,
  });

  // Derive transport mode from hosted runtime or listener bind address unless explicitly overridden.
  const effectiveTransport: "trusted_local" | "hosted" =
    options.transport ??
    (hosted || !isLoopbackListenHost(config.server.host)
      ? "hosted"
      : "trusted_local");
  const runnerKind: AllowedRunnerKind =
    options.runnerKind ??
    (effectiveTransport === "hosted" ? "hosted" : "local");

  let ownedRegistry: ProjectRegistryPort | undefined;
  let registry: ProjectRegistryPort | undefined = options.registry;
  if (!registry) {
    if (options.ledger?.db) {
      registry = createSqliteProjectRegistryAdapter({ db: options.ledger.db });
    } else if (options.useProjectRegistry || effectiveTransport === "hosted") {
      ownedRegistry = createSqliteProjectRegistryAdapter();
      registry = ownedRegistry;
    }
  }

  const enrolledCount = registry ? registry.listProjects().length : 0;
  const enforceRegistryScope = Boolean(
    options.registry || effectiveTransport === "hosted" || enrolledCount > 0,
  );
  const activeRegistry = enforceRegistryScope ? registry : undefined;
  const localDefaultProjectId =
    options.localDefaultProjectId ??
    activeRegistry?.findByLocalRoot(canonicalRoot)?.projectId ??
    activeRegistry?.findByLocalRoot(projectRoot)?.projectId;

  const vcs = options.vcs ?? createGitVcsAdapter();
  const notifier =
    options.notifier ??
    (activeRegistry
      ? createSlackNotificationAdapter({
          registry: activeRegistry,
          projectRoot,
        })
      : undefined);
  const routingService =
    options.routingService ??
    (activeRegistry
      ? createProjectRoutingService({
          registry: activeRegistry,
          notificationPort:
            notifier ??
            createSlackNotificationAdapter({
              registry: activeRegistry,
              projectRoot,
            }),
        })
      : undefined);

  // GitHub webhook is optional — plugin handles the missing case gracefully
  if (!config.server.githubWebhookSecret) {
    warnCli(
      "GitHub webhook secret not configured. Webhook endpoint will be disabled. Set GITHUB_WEBHOOK_SECRET to enable.",
    );
  }

  const monitor = new SystemMonitor(config);
  const sandbox =
    options.sandbox ??
    (options.projectRoot !== undefined || activeRegistry !== undefined
      ? new ScopedSandboxManager(projectRoot, options.gitEnv, activeRegistry)
      : new SandboxManager(projectRoot));

  const git = new GitManager(projectRoot);
  const queue = new DispatchQueue(
    config,
    monitor,
    sandbox,
    projectRoot,
    options.ledger,
    gitEnv,
    approvedBackend,
    activeRegistry,
  );

  const lifecycle = new LifecycleMonitor(config);
  const network = new NetworkMonitor(config);

  let closing = false;
  const reconnect = async () => {
    if (closing) return;
    server.log.info("Executing Graceful Reconnect Protocol...");
    lifecycle.setStatus("degraded");

    // 1. Re-sample system resources
    monitor.sample();

    // 2. Verify Git availability
    const gitOk = await sandbox.checkGit();

    if (closing) return;

    // 3. Verify network connectivity
    const networkOk = network.isOnline();

    if (gitOk && networkOk) {
      server.log.info("Reconnect successful. Resuming...");
      lifecycle.setStatus("ready");
      queue.resume();
    } else {
      server.log.warn(`Reconnect failed. Git: ${gitOk}, Network: ${networkOk}`);
      lifecycle.setStatus("degraded");
    }
  };

  lifecycle.on("server:sleep", async () => {
    server.log.info("Sleep detected. Pausing...");
    queue.pause();
  });

  lifecycle.on("server:wake", async () => {
    server.log.info("Wake detected. Waiting for health checks...");
    await reconnect();
  });

  network.on("network:down", () => {
    server.log.warn("Network down. Pausing dispatch queue.");
    queue.pause();
  });

  network.on("network:up", async () => {
    server.log.info("Network up. Verifying health...");
    await reconnect();
  });

  let ownsPidRecord = false;
  const stopPollers: Array<() => void | Promise<void>> = [];
  const cleanup: Array<() => void | Promise<void>> = [];
  if (ownedRegistry) {
    const registryToClose = ownedRegistry;
    cleanup.push(() => registryToClose.close());
  }

  const shutdown = async () => {
    server.log.info("Shutting down server...");
    try {
      await server.close();
      server.log.info("Server shut down.");
      if (options.handleSignals) process.exit(0);
    } catch (err) {
      server.log.error(err);
      if (options.handleSignals) exitCli(1);
    }
  };

  server.addHook("onClose", async () => {
    closing = true;
    process.off("SIGTERM", shutdown);
    process.off("SIGINT", shutdown);
    const errors: unknown[] = [];
    const releases = cleanup.splice(0);
    if (ownsPidRecord) {
      ownsPidRecord = false;
      releases.push(() => pid.removePid());
    }
    const releaseSafely = async (release: () => void | Promise<void>) => {
      try {
        await release();
      } catch (err) {
        errors.push(err);
      }
    };
    const drains = stopPollers.splice(0).map(releaseSafely);
    drains.push(releaseSafely(() => queue.close()));
    await Promise.all(drains);
    for (const release of releases) {
      await releaseSafely(release);
    }
    await releaseSafely(() => {
      try {
        if (ledgerLock && !options.ledger) closeDb();
      } finally {
        ledgerLock?.release();
        instanceLock?.release();
      }
    });
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1)
      throw new AggregateError(errors, "Server cleanup failed");
  });

  try {
    const routeAuthOptions = enforceRegistryScope
      ? {
          registry: activeRegistry,
          transport: effectiveTransport,
          localDefaultProjectId,
          resolvePrincipal: options.resolvePrincipal,
        }
      : undefined;

    await healthRoutes(server, lifecycle, network, sandbox, {
      registry,
      notifier,
      runnerKind,
    });
    await statusRoutes(
      server,
      monitor,
      queue,
      sandbox,
      lifecycle,
      network,
      routeAuthOptions,
    );
    await dispatchRoutes(server, queue, routeAuthOptions);
    await githubWebhookPlugin(server, {
      config,
      projectRoot,
      registry: activeRegistry,
      vcs,
      ledger: options.ledger,
      gitEnv,
    });
    await notifyRoutes(server, projectRoot, routeAuthOptions);

    const address = await server.listen({
      port: config.server.port,
      host: config.server.host,
    });
    logCliOutput(`gwrk server listening on ${address}`);

    // Register cleanup before any service can start.
    const stopPolling = () => monitor.stopPolling();
    const stopLifecycle = () => lifecycle.stop();
    const stopNetwork = () => network.stop();
    stopPollers.push(stopPolling, stopLifecycle, stopNetwork);

    pid.writePid(process.pid);
    ownsPidRecord = true;

    // FR-002: Prune worktrees on startup
    await sandbox.pruneSandboxes();

    monitor.startPolling();
    lifecycle.start();
    network.start();

    const slackApp = slackInUse ? null : getSlackApp();
    const planHeartbeat = new PlanHeartbeat(
      config,
      slackApp,
      projectRoot,
      options.ledger,
      activeRegistry || options.notifier
        ? { registry: activeRegistry, notifier: options.notifier }
        : undefined,
    );
    stopPollers.push(() => planHeartbeat.stop());
    planHeartbeat.start();

    const harvestWatcher = new HarvestWatcher(
      config,
      slackApp,
      projectRoot,
      options.ledger,
      gitEnv,
      activeRegistry ? { registry: activeRegistry } : undefined,
    );
    stopPollers.push(() => harvestWatcher.stop());
    harvestWatcher.start();

    if (!slackInUse) {
      if (slackApp) {
        slackInUse = true;
        cleanup.push(async () => {
          try {
            await stopSlackApp();
          } finally {
            slackInUse = false;
          }
        });
      }
      await startSlackApp({
        queue,
        monitor,
        sandbox,
        lifecycle,
        network,
        git,
        projectRoot,
        config,
        ...(registry ? { registry } : {}),
        ...(routingService ? { routingService } : {}),
        ...(options.vcs || activeRegistry ? { vcs } : {}),
      });
    }

    const stopTelegram = await startTelegramBot({
      queue,
      monitor,
      git,
      projectRoot,
      config,
    });
    if (typeof stopTelegram === "function") stopPollers.push(stopTelegram);

    if (options.handleSignals) {
      process.on("SIGTERM", shutdown);
      process.on("SIGINT", shutdown);
    }

    return server;
  } catch (err) {
    try {
      await server.close();
    } catch (cleanupError) {
      server.log.error(cleanupError);
    }
    server.log.error(err);
    if (options.handleSignals) exitCli(1);
    throw err;
  }
}
