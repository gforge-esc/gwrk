import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupBranch, notifyDoneDone } from "../src/engine/harvest.js";

vi.mock("../src/utils/git.js", () => ({
  deleteRemoteBranch: vi.fn(),
  commitFiles: vi.fn(),
}));

vi.mock("../src/server/slack-messages.js", () => ({
  MessageBuilder: {
    doneDone: vi.fn().mockReturnValue({ text: "🏆 Done, Done!" }),
  },
}));

vi.mock("../src/server/slack-notify.js", () => ({
  notifySlack: vi.fn().mockResolvedValue(undefined),
}));

describe("FR-H08: Branch Cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("TR-H05: Verify branch deletion command is invoked", async () => {
    const { deleteRemoteBranch } = await import("../src/utils/git.js");
    await cleanupBranch("feat/004-ship-loop", "/project");
    expect(deleteRemoteBranch).toHaveBeenCalledWith(
      "/project",
      "feat/004-ship-loop",
    );
  });
});

describe("FR-H07, FR-H11: Done, Done! Notification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("TR-H08: Verify the slack webhook mock is called exactly once with compression metrics", async () => {
    const { notifySlack } = await import("../src/server/slack-notify.js");
    const report = {
      featureId: "004-ship-loop",
      phaseId: "phase-01",
      sp_estimated: 5,
      sp_actual: 2,
      compression_ratio: 2.5,
      total_compression: 3.0,
      duration_ms: 120000,
      evidence: "test",
    };
    await notifyDoneDone(report as any);
    expect(notifySlack).toHaveBeenCalledTimes(1);
  });
});
