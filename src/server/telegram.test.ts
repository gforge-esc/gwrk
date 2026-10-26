/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DispatchQueue } from "./dispatch.js";
import type { GitManager } from "./git-manager.js";
import type { SystemMonitor } from "./monitor.js";
import type { CommandContext } from "./slack-commands.js";
import {
  formatBlocksForTelegram,
  loadTelegramConfig,
  notifyTelegram,
} from "./telegram-notify.js";
import { handleTelegramCommand, normalizeTelegramCommand } from "./telegram.js";

describe("Telegram Control Plane & Notifications", () => {
  const oldToken = process.env.TELEGRAM_BOT_TOKEN;
  const oldChat = process.env.TELEGRAM_CHAT_ID;
  let context: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TELEGRAM_BOT_TOKEN = "123456:ABC-DEF";
    process.env.TELEGRAM_CHAT_ID = "987654321";

    context = {
      userId: "tg:987654321",
      channelId: "987654321",
      projectRoot: process.cwd(),
      buildServerUrl: "http://localhost:3000",
      queue: {
        getQueue: vi.fn().mockReturnValue({
          active: [],
          queued: [],
          throttled: false,
          paused: false,
        }),
        getDispatch: vi.fn(),
        enqueue: vi.fn(),
        pause: vi.fn(),
      } as unknown as DispatchQueue,
      monitor: {
        getResources: vi.fn().mockReturnValue({
          cpuPercent: 12.5,
          memPercent: 34.0,
          diskFreeGb: 100,
        }),
      } as unknown as SystemMonitor,
      git: {
        mergePhaseBack: vi.fn(),
      } as unknown as GitManager,
    };
  });

  afterEach(() => {
    if (oldToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = oldToken;
    if (oldChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = oldChat;
  });

  it("loads Telegram config from environment variables", () => {
    const cfg = loadTelegramConfig();
    expect(cfg).toEqual({
      botToken: "123456:ABC-DEF",
      chatId: "987654321",
    });
  });

  it("normalizes /gwrk and direct slash commands for Telegram", () => {
    expect(normalizeTelegramCommand("/gwrk status")).toBe("status");
    expect(normalizeTelegramCommand("/gwrk@my_bot adr check")).toBe("adr check");
    expect(normalizeTelegramCommand("/research cold-start")).toBe(
      "research cold-start",
    );
    expect(normalizeTelegramCommand("/adr list")).toBe("adr list");
    expect(normalizeTelegramCommand("/start")).toBe("help");
    expect(normalizeTelegramCommand("hello world")).toBeNull();
  });

  it("formats Slack Block Kit blocks into Telegram text", () => {
    const text = formatBlocksForTelegram([
      {
        type: "header",
        text: { type: "plain_text", text: "🦩 gwrk — Slack Commands" },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: "*System Resources:* CPU 12.5%" },
      },
    ] as any);

    expect(text).toContain("🦩 gwrk — Slack Commands");
    expect(text).toContain("*System Resources:* CPU 12.5%");
  });

  it("routes /status and /adr check through handleTelegramCommand", async () => {
    const statusReply = await handleTelegramCommand("/status", context);
    expect(statusReply).toContain("*System Resources:* CPU 12.5%, MEM 34.0%");

    const adrReply = await handleTelegramCommand("/adr check", context);
    expect(adrReply).toContain("All ADR citations and decision index verified.");
  });

  it("posts notifications to Telegram Bot API via fetch", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = mockFetch as any;

    const sent = await notifyTelegram({
      text: "Fallback",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "✅ Phase 1 complete" },
        },
      ] as any,
    });

    expect(sent).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.telegram.org/bot123456:ABC-DEF/sendMessage",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("Phase 1 complete"),
      }),
    );
  });
});
