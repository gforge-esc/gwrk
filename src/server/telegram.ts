/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { GwrkConfig } from "../utils/config.js";
import type { DispatchQueue } from "./dispatch.js";
import type { GitManager } from "./git-manager.js";
import type { SystemMonitor } from "./monitor.js";
import { type CommandContext, handleSlashCommand } from "./slack-commands.js";
import {
  formatBlocksForTelegram,
  loadTelegramConfig,
  notifyTelegram,
} from "./telegram-notify.js";

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string };
    chat: { id: number | string };
    text?: string;
  };
}

let pollingActive = false;
let pollTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Normalizes a Telegram message text into a `handleSlashCommand` string.
 * Accepts either `/gwrk <subcommand> ...` or direct `/status`, `/research`,
 * `/adr`, `/define`, `/ship`, `/dispatch`, `/pulse`, `/effort`, `/logs`,
 * `/approve`, `/reject`, `/pause`, `/help`.
 */
export function normalizeTelegramCommand(rawText: string): string | null {
  const trimmed = rawText.trim();
  if (!trimmed.startsWith("/")) return null;

  const withoutBotHandle = trimmed.replace(/^\/([a-zA-Z0-9_]+)@[a-zA-Z0-9_]+/, "/$1");
  if (withoutBotHandle === "/gwrk" || withoutBotHandle.startsWith("/gwrk ")) {
    return withoutBotHandle.slice(5).trim() || "help";
  }

  const directCommands = new Set([
    "help",
    "status",
    "research",
    "adr",
    "define",
    "ship",
    "dispatch",
    "pulse",
    "effort",
    "logs",
    "approve",
    "reject",
    "pause",
  ]);
  const [firstToken, ...rest] = withoutBotHandle.slice(1).split(/\s+/);
  if (firstToken === "start") {
    return "help";
  }
  if (directCommands.has(firstToken)) {
    return [firstToken, ...rest].join(" ");
  }

  return null;
}

/**
 * Processes a single Telegram text command against `handleSlashCommand`.
 */
export async function handleTelegramCommand(
  rawText: string,
  context: CommandContext,
): Promise<string | null> {
  const normalized = normalizeTelegramCommand(rawText);
  if (!normalized) return null;

  const response = await handleSlashCommand(normalized, context);
  return formatBlocksForTelegram(response.blocks);
}

export async function startTelegramBot(deps: {
  queue: DispatchQueue;
  monitor: SystemMonitor;
  git: GitManager;
  projectRoot: string;
  config: GwrkConfig;
}): Promise<void> {
  const tgConfig = loadTelegramConfig(deps.projectRoot);
  if (!tgConfig || pollingActive) {
    return;
  }

  pollingActive = true;
  let lastUpdateId = 0;

  const context: CommandContext = {
    userId: `tg:${tgConfig.chatId}`,
    channelId: tgConfig.chatId,
    projectRoot: deps.projectRoot,
    buildServerUrl: `http://${deps.config.server.host}:${deps.config.server.port}`,
    queue: deps.queue,
    monitor: deps.monitor,
    git: deps.git,
  };

  const poll = async () => {
    if (!pollingActive) return;
    try {
      const url = `https://api.telegram.org/bot${tgConfig.botToken}/getUpdates?offset=${lastUpdateId + 1}&timeout=15`;
      const res = await fetch(url);
      if (res.ok) {
        const payload = (await res.json()) as {
          ok: boolean;
          result?: TelegramUpdate[];
        };
        for (const update of payload.result ?? []) {
          lastUpdateId = Math.max(lastUpdateId, update.update_id);
          const msg = update.message;
          if (!msg?.text) continue;
          if (String(msg.chat.id) !== String(tgConfig.chatId)) continue;

          const reply = await handleTelegramCommand(msg.text, context);
          if (reply) {
            await notifyTelegram(
              { text: reply, chatId: String(msg.chat.id) },
              deps.projectRoot,
            );
          }
        }
      }
    } catch {
      // Network hiccup during long poll — retry after backoff
    }

    if (pollingActive) {
      pollTimeout = setTimeout(poll, 2000);
    }
  };

  pollTimeout = setTimeout(poll, 100);
  console.log("✈️ Telegram Bot control plane is running!");
}

export async function stopTelegramBot(): Promise<void> {
  pollingActive = false;
  if (pollTimeout) {
    clearTimeout(pollTimeout);
    pollTimeout = null;
  }
}
