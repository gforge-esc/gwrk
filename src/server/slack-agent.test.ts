/**
 * Module does not exist yet (RED)
 */
import type { App } from "@slack/bolt";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildProjectContext } from "../utils/agent-context.js";
import { handleMention } from "./slack-agent.js";

// Mock agent-context to verify it is called
vi.mock("../utils/agent-context.js", () => ({
  buildProjectContext: vi
    .fn()
    .mockResolvedValue("Mocked Project Context: 5 features found."),
}));

describe("slack-agent (Phase 2 - US-015, FR-006, FR-017)", () => {
  const mockSay = vi.fn();
  const mockEvent = {
    text: "<@U123> what is the status of 003-slack?",
    user: "U456",
    ts: "1234.5678",
    channel: "C789",
    thread_ts: "1234.0000",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return a contextual intelligent response for @gwrk mentions (US-015, TR-016)", async () => {
    await handleMention({
      event: mockEvent as any,
      say: mockSay,
      projectRoot: "/test",
    });

    expect(mockSay).toHaveBeenCalledWith(
      expect.objectContaining({
        thread_ts: mockEvent.ts,
        text: expect.stringContaining("003-slack"),
      }),
    );
  });

  it("should maintain threaded context across multiple messages (US-015, TR-017)", async () => {
    const threadEvent = {
      ...mockEvent,
      thread_ts: "1111.2222",
      text: "tell me more about the first task",
    };

    await handleMention({
      event: threadEvent as any,
      say: mockSay,
      projectRoot: "/test",
    });

    expect(mockSay).toHaveBeenCalledWith(
      expect.objectContaining({
        thread_ts: threadEvent.thread_ts,
      }),
    );
  });

  it("should use buildProjectContext to answer project status queries (US-015, TR-016) [RED]", async () => {
    const statusEvent = {
      ...mockEvent,
      text: "<@U123> what is the status of the project?",
    };
    await handleMention({
      event: statusEvent as any,
      say: mockSay,
      projectRoot: "/test",
    });

    // EXPECTATION: The agent should call buildProjectContext to get real data
    expect(buildProjectContext).toHaveBeenCalled();

    // EXPECTATION: The response should contain data from the context
    expect(mockSay).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("5 features found"),
      }),
    );
  });

  it("should proffer follow-up questions to deepen the conversation (US-015) [RED]", async () => {
    await handleMention({
      event: mockEvent as any,
      say: mockSay,
      projectRoot: "/test",
    });

    expect(mockSay).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringMatching(/\?$/),
      }),
    );
  });

  it("should recognize file paths in mentions and provide contextual summaries (TR-016)", async () => {
    const fileEvent = {
      ...mockEvent,
      text: "<@U123> tell me about .agents/workflows/gwrk-analyze.md",
    };

    await handleMention({
      event: fileEvent as any,
      say: mockSay,
      projectRoot: "/test",
    });

    expect(mockSay).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("gwrk-analyze.md"),
      }),
    );
    expect(mockSay).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("cross-artifact consistency"),
      }),
    );
  });

  it("should invoke skills (e.g. architecture-stress-test) with thinking mode explanation (FR-017) [RED]", async () => {
    const skillEvent = {
      ...mockEvent,
      text: "<@U123> /skill architecture-stress-test should we use SQLite?",
    };

    await handleMention({
      event: skillEvent as any,
      say: mockSay,
      projectRoot: "/test",
    });

    expect(mockSay).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("stress test"),
      }),
    );
    expect(mockSay).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          "Invoking architecture-stress test skill",
        ),
      }),
    );
  });
});
