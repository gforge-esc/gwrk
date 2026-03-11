import { App } from "@slack/bolt";
import type { GwrkConfig } from "../utils/config.js";
import { loadSlackConfig } from "../utils/slack-client.js";
import type { DispatchQueue } from "./dispatch.js";
import type { GitManager } from "./git-manager.js";
import type { LifecycleMonitor } from "./lifecycle.js";
import type { SystemMonitor } from "./monitor.js";
import type { NetworkMonitor } from "./network.js";
import type { SandboxManager } from "./sandbox.js";
import { registerSlackActions } from "./slack-actions.js";
import { type CommandContext, handleSlashCommand } from "./slack-commands.js";
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
}) {
  const slackApp = getSlackApp();
  if (slackApp) {
    const context: CommandContext = {
      userId: "U_PE_USER", // This should be loaded or configured
      channelId: "C_GWRK_CHANNEL", // Default channel
      projectRoot: deps.projectRoot,
      buildServerUrl: `http://${deps.config.server.host}:${deps.config.server.port}`,
      queue: deps.queue,
      monitor: deps.monitor,
      git: deps.git,
    };

    // Register slash command /gwrk
    slackApp.command("/gwrk", async ({ command, ack, respond }) => {
      await ack();
      const response = await handleSlashCommand(command.text, context);
      await respond(response);
    });

    // Register actions and events
    await registerSlackActions(slackApp, context);

    // Register App Home handler
    await registerSlackHomeHandler(slackApp, deps);

    // Initialize presence poller
    await presenceManager.init(deps.projectRoot);

    await slackApp.start();
    console.log("⚡️ Slack Bolt app is running!");
  }
}

export async function stopSlackApp() {
  if (app) {
    presenceManager.stop();
    await app.stop();
    app = null;
    console.log("🛑 Slack Bolt app stopped.");
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
