/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  SYNTHETIC_CHANNEL_ALPHA,
  SYNTHETIC_USER_MAINTAINER,
  SYNTHETIC_USER_VIEWER,
  SYNTHETIC_WORKSPACE_ID,
  createSyntheticRegistry,
} from "../../tests/helpers/synthetic-slack.js";
import { createProjectRoutingService } from "../application/project-routing/index.js";
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

describe("TR-011: Slack Agent Mentions and Direct Messages project resolution and roles", () => {
  const registry = createSyntheticRegistry();
  const routingService = createProjectRoutingService({ registry });

  it("a DM without --project returns AMBIGUOUS_PROJECT_SELECTION", async () => {
    const say = vi.fn();
    const event = {
      text: "what is the status?",
      channel: "D12345",
      user: SYNTHETIC_USER_MAINTAINER,
      team: SYNTHETIC_WORKSPACE_ID,
      ts: "1731320000.000100",
    };

    await handleDirectMessage({
      event,
      say,
      projectRoot: "/tmp",
      routingService,
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
      team: SYNTHETIC_WORKSPACE_ID,
      ts: "1731320000.000100",
    };

    await handleMention({
      event: event as any,
      say,
      projectRoot: "/tmp",
      routingService,
    });

    expect(say).toHaveBeenCalledOnce();
    expect(say).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("UNAUTHORIZED_USER"),
      }),
    );
  });

  it("a viewer cannot trigger an operate-level mention", async () => {
    const say = vi.fn();
    const event = {
      text: "@gwrk please run stress test on this feature",
      channel: SYNTHETIC_CHANNEL_ALPHA,
      user: SYNTHETIC_USER_VIEWER,
      team: SYNTHETIC_WORKSPACE_ID,
      ts: "1731320000.000100",
    };

    await handleMention({
      event: event as any,
      say,
      projectRoot: "/tmp",
      routingService,
    });

    expect(say).toHaveBeenCalledOnce();
    expect(say).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("INSUFFICIENT_ROLE"),
      }),
    );
  });

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
