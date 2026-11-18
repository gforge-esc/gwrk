/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { App } from "@slack/bolt";
import { logCliOutput, warnCli } from "../adapters/cli/output-scope.js";
import { createGitVcsAdapter } from "../adapters/git/index.js";
import { createSqliteProjectRegistryAdapter } from "../adapters/sqlite/index.js";
import {
  type ProjectRoutingService,
  createProjectRoutingService,
} from "../application/project-routing/index.js";
import type { ProjectRegistryPort } from "../ports/store-port.js";
import type { VcsPort } from "../ports/vcs-port.js";
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
import { type CommandContext, handleSlashCommand } from "./slack-commands.js";
import { registerSlackHomeHandler } from "./slack-home.js";
import { registerMentionHandler } from "./slack-mentions.js";
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
  vcs?: VcsPort;
}) {
  const slackApp = getSlackApp();
  if (slackApp) {
    let registry = deps.registry;
    if (!registry) {
      try {
        registry = createSqliteProjectRegistryAdapter();
      } catch (err) {
        warnCli(
          `Failed to initialize project registry: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const routingService =
      deps.routingService ??
      (registry ? createProjectRoutingService({ registry }) : undefined);

    if (!routingService) {
      warnCli(
        "ProjectRoutingService is unavailable. Refusing to register Slack command, action, mention and message handlers.",
      );
      return;
    }

    const vcs = deps.vcs ?? createGitVcsAdapter();

    const baseContext = {
      projectRoot: deps.projectRoot,
      buildServerUrl: `http://${deps.config.server.host}:${deps.config.server.port}`,
      queue: deps.queue,
      monitor: deps.monitor,
      git: deps.git,
      routingService,
      vcs,
    };

    // Register slash command /gwrk with per-event context resolution
    slackApp.command("/gwrk", async ({ command, ack, respond }) => {
      await ack();
      const eventContext: CommandContext = {
        ...baseContext,
        userId: command.user_id,
        channelId: command.channel_id,
        workspaceId: command.team_id,
      };
      const response = await handleSlashCommand(command.text, eventContext);
      await respond(response);
    });

    // Register actions and events with per-event authorization capability
    const actionContext: CommandContext = {
      ...baseContext,
      userId: "",
      channelId: "",
    };
    await registerSlackActions(slackApp, actionContext);

    // Register @gwrk mention handler (listens for app_mention events)
    slackApp.event("app_mention", async ({ event, say }) => {
      await handleMention({
        event,
        say,
        projectRoot: deps.projectRoot,
        routingService,
      });
    });

    // Handle direct messages and threaded messages in channels
    slackApp.event("message", async ({ event, say }) => {
      // biome-ignore lint/suspicious/noExplicitAny: Slack message event
      const msgEvent = event as any;
      if (msgEvent.channel_type === "im" || msgEvent.channel?.startsWith("D")) {
        await handleDirectMessage({
          event,
          say,
          projectRoot: deps.projectRoot,
          routingService,
        });
      }
    });

    // Register App Home handler
    await registerSlackHomeHandler(slackApp, { ...deps, registry });

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
