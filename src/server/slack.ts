import { App } from "@slack/bolt";
import { loadSlackConfig } from "../utils/slack-client.js";

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

export async function startSlackApp() {
  const slackApp = getSlackApp();
  if (slackApp) {
    await slackApp.start();
    console.log("⚡️ Slack Bolt app is running!");
  }
}

export async function stopSlackApp() {
  if (app) {
    await app.stop();
    app = null;
    console.log("🛑 Slack Bolt app stopped.");
  }
}

export function resetSlackApp() {
  app = null;
}
