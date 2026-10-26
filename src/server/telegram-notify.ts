/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { KnownBlock } from "@slack/types";
import type { SlackMessage } from "./slack-messages.js";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

function readJsonSafe(filePath: string): Record<string, any> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Resolves Telegram bot configuration from environment variables,
 * `.gwrkrc.local.json`, or `~/.gwrk/config.json`.
 */
export function loadTelegramConfig(
  projectRoot: string = process.cwd(),
): TelegramConfig | null {
  const envToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const envChatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (envToken && envChatId) {
    return { botToken: envToken, chatId: envChatId };
  }

  const localCfg = readJsonSafe(path.join(projectRoot, ".gwrkrc.local.json"));
  const localTg = localCfg?.project?.telegram ?? localCfg?.telegram;
  const globalHome = process.env.GWRK_HOME || path.join(os.homedir(), ".gwrk");
  const globalCfg = readJsonSafe(path.join(globalHome, "config.json"));
  const globalTg = globalCfg?.telegram ?? globalCfg?.project?.telegram;

  const botToken = envToken || localTg?.botToken || globalTg?.botToken;
  const chatId = envChatId || localTg?.chatId || globalTg?.chatId;

  if (typeof botToken === "string" && botToken && typeof chatId === "string" && chatId) {
    return { botToken, chatId: String(chatId) };
  }

  return null;
}

/**
 * Converts Slack Block Kit blocks into clean plain/Markdown text for Telegram.
 */
export function formatBlocksForTelegram(blocks?: KnownBlock[], fallbackText?: string): string {
  if (!blocks || blocks.length === 0) {
    return fallbackText || "";
  }

  const parts: string[] = [];
  for (const block of blocks as any[]) {
    if (block.type === "header" && block.text?.text) {
      parts.push(String(block.text.text));
    } else if (block.type === "section") {
      if (block.text?.text) {
        parts.push(String(block.text.text));
      }
      if (Array.isArray(block.fields)) {
        parts.push(
          block.fields
            .map((f: any) => f?.text)
            .filter(Boolean)
            .join("\n"),
        );
      }
    } else if (block.type === "context" && Array.isArray(block.elements)) {
      parts.push(
        block.elements
          .map((e: any) => e?.text)
          .filter(Boolean)
          .join(" · "),
      );
    }
  }

  const joined = parts.filter(Boolean).join("\n\n").trim();
  return joined || fallbackText || "";
}

/**
 * Sends a notification message via the Telegram Bot API.
 */
export async function notifyTelegram(
  message: SlackMessage | { text: string; blocks?: KnownBlock[]; chatId?: string },
  projectRoot: string = process.cwd(),
): Promise<boolean> {
  const cfg = loadTelegramConfig(projectRoot);
  if (!cfg) return false;

  const chatId = ("chatId" in message && message.chatId) || cfg.chatId;
  const text = formatBlocksForTelegram(message.blocks, message.text);
  if (!text) return false;

  const url = `https://api.telegram.org/bot${cfg.botToken}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 4000),
        disable_web_page_preview: true,
      }),
    });
    return res.ok;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Failed to send Telegram notification: ${msg}`);
    return false;
  }
}
