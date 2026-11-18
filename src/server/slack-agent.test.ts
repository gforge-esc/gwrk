/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as fs from "node:fs";
import type { App, SlackEventMiddlewareArgs } from "@slack/bolt";
import { describe, expect, it, vi } from "vitest";
import {
  SYNTHETIC_CHANNEL_ALPHA,
  SYNTHETIC_PROJECT_ALPHA,
  SYNTHETIC_PROJECT_BETA,
  SYNTHETIC_THREAD_ALPHA,
  SYNTHETIC_USER_MAINTAINER,
  SYNTHETIC_USER_VIEWER,
  SYNTHETIC_WORKSPACE_ID,
  createSyntheticRegistry,
  createSyntheticVcsPort,
} from "../../tests/helpers/synthetic-slack.js";
import { createProjectRoutingService } from "../application/project-routing/index.js";
import { registerSlackActions } from "./slack-actions.js";
import { handleDirectMessage, handleMention } from "./slack-agent.js";

describe("TR-P10-004: Slack Agent Legacy Removal", () => {
  it("ADR-007: contains no hardcoded .agents/workflows/ references (TR-P10-004)", () => {
    const source = fs.readFileSync("src/server/slack-agent.ts", "utf8");
    expect(source).not.toContain(".agents/workflows/");
  });

  it("should not contain any .agents/ references in the file (Negative Path)", () => {
    const source = fs.readFileSync("src/server/slack-agent.ts", "utf8");
    const agentsPaths = source.match(/\.agents\//g);
    expect(
      agentsPaths,
      `Found legacy .agents/ paths: ${agentsPaths}`,
    ).toBeNull();
  });
});

describe("TR-011: Slack project selection and role enforcement", () => {
  const registry = createSyntheticRegistry();
  const routingService = createProjectRoutingService({ registry });

  it("a DM without --project returns AMBIGUOUS_PROJECT_SELECTION", async () => {
    const say = vi.fn();
    const event = {
      text: "what is the status?",
      channel: "D12345",
      user: SYNTHETIC_USER_MAINTAINER,
      ts: "1731320000.000100",
    };

    await handleDirectMessage({
      event,
      say,
      projectRoot: "/tmp",
      routingService,
      workspaceId: SYNTHETIC_WORKSPACE_ID,
    });

    expect(say).toHaveBeenCalledOnce();
    expect(say).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("AMBIGUOUS_PROJECT_SELECTION"),
      }),
    );
  });

  it("a mention from an unbound user returns UNAUTHORIZED_USER", async () => {
    const say = vi.fn();
    const event = {
      text: "@gwrk status of the project",
      channel: SYNTHETIC_CHANNEL_ALPHA,
      user: "U_STRANGER",
      ts: "1731320000.000100",
    };

    await handleMention({
      event: event as any,
      say,
      projectRoot: "/tmp",
      routingService,
      workspaceId: SYNTHETIC_WORKSPACE_ID,
    });

    expect(say).toHaveBeenCalledOnce();
    expect(say).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("UNAUTHORIZED_USER"),
      }),
    );
  });

  it.each(["stress test", "/skill", "plugin system"])(
    "denies a viewer's %s skill mention",
    async (phrase) => {
      const say = vi.fn();
      await handleMention({
        event: {
          type: "app_mention",
          text: `@gwrk ${phrase}`,
          channel: SYNTHETIC_CHANNEL_ALPHA,
          user: SYNTHETIC_USER_VIEWER,
          ts: "1731320000.000100",
          event_ts: "1731320000.000100",
        },
        say,
        projectRoot: "/tmp",
        routingService,
        workspaceId: SYNTHETIC_WORKSPACE_ID,
      });

      expect(say).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          text: expect.stringContaining("INSUFFICIENT_ROLE"),
        }),
      );
    },
  );

  it.each([
    [
      SYNTHETIC_USER_VIEWER,
      SYNTHETIC_PROJECT_ALPHA.projectId,
      "INSUFFICIENT_ROLE",
    ],
    [
      SYNTHETIC_USER_MAINTAINER,
      SYNTHETIC_PROJECT_BETA.projectId,
      "THREAD_PROJECT_MISMATCH",
    ],
  ])(
    "denies a reaction by %s to a card for %s",
    async (user, projectId, code) => {
      const registry = createSyntheticRegistry();
      const claim = vi.spyOn(registry, "claimActionReceipt");
      const vcs = createSyntheticVcsPort();
      const app = { action: vi.fn(), event: vi.fn() };
      await registerSlackActions(
        app as unknown as App,
        {
          projectRoot: "/tmp",
          routingService: createProjectRoutingService({ registry }),
          vcs,
        } as Parameters<typeof registerSlackActions>[1],
      );
      expect(app.event).toHaveBeenCalledWith(
        "reaction_added",
        expect.any(Function),
      );

      const ts = "1731320000.000200";
      const event: SlackEventMiddlewareArgs<"reaction_added">["event"] = {
        type: "reaction_added",
        user,
        item_user: "U_GWRK_BOT",
        reaction: "white_check_mark",
        item: { type: "message", channel: SYNTHETIC_CHANNEL_ALPHA, ts },
        event_ts: "1731320000.000300",
      };
      const logger = { error: vi.fn() };
      await app.event.mock.calls[0][1]({
        event,
        body: { type: "event_callback" },
        context: { teamId: SYNTHETIC_WORKSPACE_ID },
        client: {
          chat: { postEphemeral: vi.fn() },
          reactions: {
            get: vi.fn().mockResolvedValue({
              message: {
                ts,
                thread_ts: SYNTHETIC_THREAD_ALPHA.rootTs,
                blocks: [
                  {
                    type: "actions",
                    elements: [
                      {
                        type: "button",
                        action_id: "merge_pr",
                        value: JSON.stringify({
                          projectId,
                          featureId: SYNTHETIC_THREAD_ALPHA.featureId,
                        }),
                      },
                    ],
                  },
                ],
              },
            }),
          },
        },
        logger,
      });

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(code));
      expect(claim).not.toHaveBeenCalled();
      expect(vcs.mergedPrs).toHaveLength(0);
      claim.mockRestore();
    },
  );

  it.each([{ bot_id: "B_SELF" }, { subtype: "message_changed" }])(
    "ignores a direct message with %j",
    async (metadata) => {
      const say = vi.fn();
      await handleDirectMessage({
        event: {
          ...metadata,
          text: "hello --project alpha",
          channel: "D123",
          user: SYNTHETIC_USER_MAINTAINER,
          team: SYNTHETIC_WORKSPACE_ID,
          ts: "1731320000.000100",
        },
        say,
        projectRoot: "/tmp",
        routingService,
      });
      expect(say).not.toHaveBeenCalled();
    },
  );

  it("denies mentions and direct messages when routingService is undefined", async () => {
    const sayMention = vi.fn();
    await handleMention({
      event: {
        text: "@gwrk hello",
        channel: SYNTHETIC_CHANNEL_ALPHA,
        user: SYNTHETIC_USER_MAINTAINER,
        ts: "1.1",
      } as any,
      say: sayMention,
      projectRoot: "/tmp",
      routingService: undefined,
    });
    expect(sayMention).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("without project routing configuration"),
      }),
    );

    const sayDm = vi.fn();
    await handleDirectMessage({
      event: {
        text: "hello",
        channel: "D123",
        user: SYNTHETIC_USER_MAINTAINER,
        ts: "1.1",
      },
      say: sayDm,
      projectRoot: "/tmp",
      routingService: undefined,
    });
    expect(sayDm).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("without project routing configuration"),
      }),
    );
  });
});
