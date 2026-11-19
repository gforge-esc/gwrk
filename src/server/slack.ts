/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { App } from "@slack/bolt";
import { logCliOutput, warnCli } from "../adapters/cli/output-scope.js";
import { createGitVcsAdapter } from "../adapters/git/index.js";
import { createSlackNotificationAdapter } from "../adapters/notifications/index.js";
import { createSqliteProjectRegistryAdapter } from "../adapters/sqlite/index.js";
import {
  type ProjectRoutingService,
  createProjectRoutingService,
} from "../application/project-routing/index.js";
import type { ProjectRegistryPort } from "../ports/store-port.js";
import type { VcsProjectPort } from "../ports/vcs-port.js";
import type { GwrkConfig } from "../utils/config.js";
import { loadSlackConfig } from "../utils/slack-client.js";
import type { DispatchQueue } from "./dispatch.js";
import type { GitManager } from "./git-manager.js";
import type { LifecycleMonitor } from "./lifecycle.js";
import type { SystemMonitor } from "./monitor.js";
import type { NetworkMonitor } from "./network.js";
import type { SandboxManager } from "./sandbox.js";
import { registerSlackActions } from "./slack-actions.js";
import { handleDirectMessage, handleMention } from "./slack-agent.js";
import {
  type CommandContext,
  handleSlashCommand,
  resolveSlackCheckout,
} from "./slack-commands.js";
import { registerSlackHomeHandler } from "./slack-home.js";
import { presenceManager } from "./slack-presence.js";

let app: App | null = null;

export function getSlackApp(): App | null {
  if (app) return app;

  const config = loadSlackConfig();
  if (!config) {
    return null;
  }

  app = new App({
    token: config.botToken,
    appToken: config.appToken,
    socketMode: true,
  });

  return app;
}

/**
 * Resets the singleton Slack app instance for testing purposes.
 */
export function resetSlackApp() {
  app = null;
}

export async function startSlackApp(deps: {
  queue: DispatchQueue;
  monitor: SystemMonitor;
  sandbox: SandboxManager;
  lifecycle: LifecycleMonitor;
  network: NetworkMonitor;
  git: GitManager;
  projectRoot: string;
  config: GwrkConfig;
  registry?: ProjectRegistryPort;
  routingService?: ProjectRoutingService;
  vcs?: VcsProjectPort;
}) {
  const slackApp = getSlackApp();
  if (slackApp) {
    let registry: ProjectRegistryPort;
    try {
      registry = deps.registry ?? createSqliteProjectRegistryAdapter();
    } catch (error) {
      warnCli(
        `Slack startup skipped. Project registry initialization failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    const routingService =
      deps.routingService ??
      createProjectRoutingService({
        registry,
        notificationPort: createSlackNotificationAdapter(),
      });

    const vcs = deps.vcs ?? createGitVcsAdapter();

    const queueProjects = registry
      .listProjects()
      .filter(
        (project) =>
          resolveSlackCheckout(project, deps.projectRoot) !== undefined,
      );
    const baseContext = {
      projectRoot: deps.projectRoot,
      buildServerUrl: `http://${deps.config.server.host}:${deps.config.server.port}`,
      queue: deps.queue,
      queueProjectId:
        queueProjects.length === 1 ? queueProjects[0].projectId : undefined,
      monitor: deps.monitor,
      git: deps.git,
      routingService,
      vcs,
    };

    // Register slash command /gwrk with per-event context resolution
    slackApp.command("/gwrk", async ({ command, ack, respond, client }) => {
      await ack();
      const eventContext: CommandContext = {
        ...baseContext,
        userId: command.user_id,
        channelId: command.channel_id,
        workspaceId: command.team_id,
      };
      const response = await handleSlashCommand(command.text, eventContext);
      if (response.response_type === "ephemeral" && response.thread_ts) {
        await client.chat.postEphemeral({
          channel: eventContext.channelId,
          user: command.user_id,
          thread_ts: response.thread_ts,
          blocks: response.blocks,
        });
        return;
      }
      await respond(
        response.thread_ts
          ? { ...response, replace_original: false }
          : response,
      );
    });

    // Register actions and events with per-event authorization capability
    const actionContext: CommandContext = {
      ...baseContext,
      userId: "",
      channelId: "",
    };
    await registerSlackActions(slackApp, actionContext);

    slackApp.event("app_mention", async ({ event, body, context, say }) => {
      await handleMention({
        event,
        say,
        projectRoot: deps.projectRoot,
        routingService,
        workspaceId: body?.team_id ?? context?.teamId ?? event.team,
      });
    });

    slackApp.event("message", async ({ event, body, context, say }) => {
      if (event.subtype || event.bot_id) return;
      if (event.channel_type === "im" || event.channel.startsWith("D")) {
        await handleDirectMessage({
          event,
          say,
          projectRoot: deps.projectRoot,
          routingService,
          workspaceId: body?.team_id ?? context?.teamId ?? event.team,
        });
      }
    });

    // Register App Home handler
    await registerSlackHomeHandler(slackApp, {
      ...deps,
      registry,
      queueProjectId: baseContext.queueProjectId,
    });

    // Initialize presence poller
    await presenceManager.init(deps.config);

    await slackApp.start();
    logCliOutput("⚡️ Slack Bolt app is running!");
  }
}

export async function stopSlackApp() {
  if (app) {
    presenceManager.stop();
    await app.stop();
    app = null;
    logCliOutput("🛑 Slack Bolt app stopped.");
  }
}

export async function isSlackConnected(): Promise<boolean> {
  if (!app) return false;
  try {
    const result = await app.client.auth.test();
    return result.ok;
  } catch (err) {
    return false;
  }
}
