/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  logCliOutput,
  setCliExitCode,
  writeScopedStderr,
} from "../adapters/cli/output-scope.js";
import { gwrkHome, usesHostedRuntime } from "../adapters/config/paths.js";
import { resolveProjectId } from "../adapters/git/project-id.js";
import {
  createSqliteOperationsStoreAdapter,
  createSqliteProjectRegistryAdapter,
} from "../adapters/sqlite/index.js";
import { openDatabase } from "../db/index.js";
import { quotaProbe } from "../engine/quota.js";
import { AgentBackendRegistry } from "../plugins/agent-registry.js";
import { PluginLoader } from "../plugins/loader.js";
import type { SlackDeliveryStatus } from "../ports/notification-port.js";
import type { DurableOperationsStatus } from "../ports/operations-port.js";
import { isPidRunning, readPid } from "../server/pid.js";
import type { HealthResponse, SystemStatus } from "../server/types.js";
import { type GwrkConfig, loadConfig } from "../utils/config.js";
import { color } from "../utils/format.js";
import { getCurrentBranch, isWorkingTreeClean } from "../utils/git.js";
import { createOutput, resolveFormat } from "../utils/output.js";
import { withSignal } from "../utils/signal.js";
import { evaluateEnrolledProjectReadiness } from "./project-enroll.js";

const { BOLD, DIM, CYAN, GREEN, YELLOW, RED, RESET } = color;

const SERVER_PROBE_TIMEOUT_MS = 5_000;

function hasExplicitServerBlock(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
      server?: Record<string, unknown>;
    };
    return Boolean(
      parsed.server &&
        typeof parsed.server === "object" &&
        (parsed.server.host !== undefined || parsed.server.port !== undefined),
    );
  } catch {
    return false;
  }
}

function isServerConfigured(
  projectRoot: string,
  config: GwrkConfig,
  pid: number | undefined,
  explicitServerUrl?: string,
): boolean {
  if (explicitServerUrl?.trim()) return true;
  if (process.env.GWRK_SERVER_URL?.trim()) return true;
  if (pid !== undefined) return true;
  if (config.server.host !== "localhost" || config.server.port !== 18790) {
    return true;
  }
  return (
    hasExplicitServerBlock(path.join(projectRoot, ".gwrkrc.json")) ||
    hasExplicitServerBlock(path.join(projectRoot, ".gwrkrc.local.json")) ||
    hasExplicitServerBlock(path.join(gwrkHome(), "config.json"))
  );
}

function resolveServerBaseUrl(
  config: GwrkConfig,
  explicitServerUrl?: string,
): string {
  const configured =
    explicitServerUrl?.trim() || process.env.GWRK_SERVER_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  return `http://${config.server.host}:${config.server.port}`;
}

export const createStatusCommand = () =>
  new Command("status")
    .description("Show gwrk build server and system status")
    .option("--json", "Output status as JSON")
    .option("--format <type>", "Output format (text, json)")
    .option("--server-url <url>", "Override configured server base URL")
    .addHelpText(
      "after",
      `
Type: query (read-only)
Format: use --json or gwrk --format json for structured output
Exit codes:
  0: Success
  1: Configured or running server unreachable, or config missing
  2: Usage error
`,
    )
    .action(
      async (
        options: { json?: boolean; format?: string; serverUrl?: string },
        command: Command,
      ) => {
        await withSignal("status", async () => {
          const out = options.json
            ? createOutput("json")
            : options.format
              ? createOutput(
                  options.format === "text" ? undefined : options.format,
                )
              : resolveFormat(command);

          const projectRoot = process.cwd();
          const canonicalRoot = fs.existsSync(projectRoot)
            ? fs.realpathSync(projectRoot)
            : projectRoot;
          const config = loadConfig(projectRoot);

          const pid = readPid();
          const pidRunning = Boolean(pid && isPidRunning(pid));
          let daemonLiveness: "alive" | "stopped" = pidRunning
            ? "alive"
            : "stopped";
          const serverConfigured = isServerConfigured(
            projectRoot,
            config,
            pid,
            options.serverUrl,
          );
          const serverUrl = resolveServerBaseUrl(config, options.serverUrl);

          let localProjectId = resolveProjectId(canonicalRoot);
          let enrolledProject = null;
          let localReadiness: HealthResponse["projectReadiness"] = {
            status: "unconfigured",
            readyCount: 0,
            totalCount: 0,
            projects: [],
          };
          let durableOperations: DurableOperationsStatus | null = null;

          try {
            const db = openDatabase();
            try {
              const registry = createSqliteProjectRegistryAdapter({ db });
              enrolledProject =
                registry.findByLocalRoot(canonicalRoot) ??
                registry.findByLocalRoot(projectRoot) ??
                registry.getProject(localProjectId);
              if (enrolledProject) {
                localProjectId = enrolledProject.projectId;
              }
              const runnerKind = usesHostedRuntime() ? "hosted" : "local";
              const projects = registry
                .listProjects()
                .map((p) => evaluateEnrolledProjectReadiness(p, runnerKind));
              const readyCount = projects.filter(
                (p) => p.status === "ready",
              ).length;
              localReadiness = {
                status:
                  projects.length === 0
                    ? "unconfigured"
                    : readyCount === projects.length
                      ? "ready"
                      : "degraded",
                readyCount,
                totalCount: projects.length,
                projects,
              };

              if (enrolledProject) {
                const opsStore = createSqliteOperationsStoreAdapter({ db });
                durableOperations = opsStore.getOperationsStatus(
                  enrolledProject.projectId,
                );
              }
            } finally {
              if (db.open) db.close();
            }
          } catch {
            // Local registry or durable operations store unavailable.
          }

          let serverReachable = false;
          let serverError: string | undefined;
          let healthData: HealthResponse | undefined;
          let serverStatus: SystemStatus | undefined;

          if (serverConfigured) {
            const signal = AbortSignal.timeout(SERVER_PROBE_TIMEOUT_MS);
            try {
              const healthResp = await fetch(`${serverUrl}/api/health`, {
                signal,
              });
              if (!healthResp.ok) {
                throw new Error(
                  `Health check returned HTTP ${healthResp.status}`,
                );
              }
              healthData = (await healthResp.json()) as HealthResponse;
              if (healthData.daemonLiveness === "alive") {
                daemonLiveness = "alive";
              }

              const statusQuery = enrolledProject
                ? `?projectId=${encodeURIComponent(enrolledProject.projectId)}`
                : "";
              const statusResp = await fetch(
                `${serverUrl}/api/status${statusQuery}`,
                { signal },
              );
              if (!statusResp.ok) {
                throw new Error(
                  `Status check returned HTTP ${statusResp.status}`,
                );
              }
              serverStatus = (await statusResp.json()) as SystemStatus;
              serverReachable = true;
            } catch (err) {
              serverReachable = false;
              serverError = err instanceof Error ? err.message : String(err);
            }
          }

          const projectReadiness =
            healthData?.projectReadiness ?? localReadiness;
          const slackDelivery: SlackDeliveryStatus =
            healthData?.slackDelivery ?? {
              mode: "disabled",
              connected: false,
            };
          const telegram = healthData?.telegram ?? {
            enabled: false as const,
            reason: "disabled_in_pilot" as const,
          };

          const shouldFail = serverConfigured && !serverReachable;

          if (out.isJson) {
            const branch = getCurrentBranch(projectRoot);
            const isDirty = !isWorkingTreeClean(projectRoot);
            const specsDir = path.join(projectRoot, "specs");
            const specs = fs.existsSync(specsDir)
              ? fs
                  .readdirSync(specsDir)
                  .filter((d) =>
                    fs.statSync(path.join(specsDir, d)).isDirectory(),
                  )
              : [];

            const statusData: Record<string, unknown> = {
              project: {
                name: config.project.name,
                root: projectRoot,
                projectId: localProjectId,
                slug: enrolledProject?.slug ?? null,
                enrolled: Boolean(enrolledProject),
                git: { branch, clean: !isDirty },
              },
              specs: specs.length,
              agents: config.agents,
              daemonLiveness,
              serverConfigured,
              serverReachable,
              serverUrl,
              ...(serverError ? { serverError } : {}),
              projectReadiness,
              slackDelivery,
              telegram,
              durableOperations,
            };

            if (serverStatus) {
              statusData.server = serverStatus.server;
              statusData.system = serverStatus.system;
              statusData.dispatch = serverStatus.dispatch;
              statusData.sandboxes = serverStatus.sandboxes;
              statusData.network = serverStatus.network;
            }

            out.write(statusData);
            if (shouldFail) {
              writeScopedStderr(
                `hint: Server at ${serverUrl} is unreachable (${serverError}). Run 'gwrk server start' or verify the configured server URL.\n`,
              );
              setCliExitCode(1);
            }
            return;
          }

          if (!serverConfigured) {
            logCliOutput(
              `\n  ${RED}●${RESET} ${BOLD}gwrk server is stopped${RESET} (${DIM}daemonLiveness: ${daemonLiveness}${RESET})`,
            );
            logCliOutput(`    Run 'gwrk server start' to start the server.`);
            printOperationalReadiness(
              projectReadiness,
              slackDelivery,
              telegram,
            );
            await printAgents();
            return;
          }

          if (!serverReachable || !serverStatus) {
            logCliOutput(
              `\n  ${YELLOW}●${RESET} ${BOLD}gwrk server is unreachable${RESET} (${DIM}daemonLiveness: ${daemonLiveness}${pid ? `, PID ${pid}` : ""}${RESET})`,
            );
            logCliOutput(`    ${DIM}Endpoint: ${serverUrl}${RESET}`);
            if (serverError) {
              logCliOutput(`    ${DIM}Error:    ${serverError}${RESET}`);
            }
            printOperationalReadiness(
              projectReadiness,
              slackDelivery,
              telegram,
            );
            await printAgents();
            writeScopedStderr(
              `hint: Run 'gwrk server start' or verify the configured server endpoint.\n`,
            );
            setCliExitCode(1);
            return;
          }

          printStatus(serverStatus, daemonLiveness);
          printOperationalReadiness(projectReadiness, slackDelivery, telegram);
          await printAgents();
        });
      },
    );

export const statusCommand = createStatusCommand();

function printOperationalReadiness(
  readiness: HealthResponse["projectReadiness"],
  slackDelivery: SlackDeliveryStatus,
  telegram: HealthResponse["telegram"],
) {
  logCliOutput(`\n  ${CYAN}Project Readiness${RESET}`);
  logCliOutput(
    `    ${DIM}Status:   ${RESET}${readiness.status} (${readiness.readyCount}/${readiness.totalCount} ready)`,
  );
  for (const project of readiness.projects) {
    logCliOutput(
      `    ${DIM}${project.slug.padEnd(16)}${RESET} | ${project.status}${project.reason ? ` (${project.reason})` : ""}`,
    );
  }

  logCliOutput(`\n  ${CYAN}Delivery${RESET}`);
  logCliOutput(
    `    ${DIM}Slack:    ${RESET}${slackDelivery.mode} (connected: ${slackDelivery.connected})${slackDelivery.lastError ? ` - ${slackDelivery.lastError}` : ""}`,
  );
  logCliOutput(`    ${DIM}Telegram: ${RESET}disabled (${telegram.reason})`);
}

async function printAgents() {
  logCliOutput(`\n  ${CYAN}Agent Backends${RESET}`);
  const loader = new PluginLoader();
  const registry = new AgentBackendRegistry(loader);
  const backends = await registry.getBackends();

  for (const [backendName, adapter] of Object.entries(backends)) {
    const q = await quotaProbe(adapter);
    let statusStr = "";
    switch (q.status) {
      case "available":
        statusStr = `${GREEN}Available${RESET}`;
        break;
      case "rate-limited":
        statusStr = `${YELLOW}Rate Limited${RESET} (backoff: ${q.backoffS}s)`;
        break;
      case "exhausted":
        statusStr = `${RED}Exhausted${RESET}`;
        break;
      case "unknown":
        statusStr = `${DIM}Unknown quota${RESET}`;
        break;
      case "unavailable":
        statusStr = `${RED}Unavailable${RESET}`;
        break;
    }
    logCliOutput(`    ${DIM}${backendName.padEnd(12)}${RESET} | ${statusStr}`);
  }
}

function printStatus(
  status: SystemStatus,
  daemonLiveness: "alive" | "stopped",
) {
  const { server, system, dispatch, sandboxes } = status;

  logCliOutput(
    `\n  ${GREEN}●${RESET} ${BOLD}gwrk server is running${RESET} (${DIM}daemonLiveness: ${daemonLiveness}, serverReachable: true${RESET})`,
  );
  logCliOutput(`    ${DIM}PID:    ${RESET}${server.pid}`);
  logCliOutput(`    ${DIM}Uptime: ${RESET}${formatUptime(server.uptime || 0)}`);
  logCliOutput(`    ${DIM}Port:   ${RESET}${server.port}`);

  logCliOutput(`\n  ${CYAN}System Resources${RESET}`);
  logCliOutput(`    ${DIM}CPU:    ${RESET}${formatPercent(system.cpuPercent)}`);
  logCliOutput(`    ${DIM}Memory: ${RESET}${formatPercent(system.memPercent)}`);
  logCliOutput(`    ${DIM}Disk:   ${RESET}${system.diskFreeGb} GB free`);

  logCliOutput(`\n  ${CYAN}Dispatch Queue${RESET}`);
  logCliOutput(`    ${DIM}Queued:    ${RESET}${dispatch.queueDepth}`);
  logCliOutput(`    ${DIM}Active:    ${RESET}${dispatch.activeCount}`);
  logCliOutput(`    ${DIM}Completed: ${RESET}${dispatch.completedCount}`);
  logCliOutput(`    ${DIM}Failed:    ${RESET}${dispatch.failedCount}`);

  if (sandboxes.length > 0) {
    logCliOutput(`\n  ${CYAN}Active Sandboxes${RESET}`);
    for (const sb of sandboxes) {
      logCliOutput(
        `    ${DIM}${sb.taskId.padEnd(12)}${RESET} | ${sb.featureId} | ${sb.phaseId} | ${sb.status}`,
      );
    }
  }

  logCliOutput("");
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
}

function formatPercent(val: number): string {
  let c = RESET;
  if (val > 80) c = RED;
  else if (val > 60) c = YELLOW;
  return `${c}${val}%${RESET}`;
}
