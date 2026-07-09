/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it, vi } from "vitest";
import { associateIssueWithFeature, notifyIssueOpened } from "./issues.js";
import { notifySlack } from "../server/slack-notify.js";

vi.mock("../server/slack-notify.js", () => ({
  notifySlack: vi.fn(),
}));

describe("FR-H13: Issue-to-Feature Association", () => {
  it("should associate via label", () => {
    const issue = {
      title: "Some issue",
      labels: ["gwrk:011-harvest", "bug"]
    };
    expect(associateIssueWithFeature(issue)).toBe("011-harvest");
  });

  it("should associate via title [NNN]", () => {
    const issue = {
      title: "[011] Harvest failing",
      labels: []
    };
    expect(associateIssueWithFeature(issue)).toBe("011-harvest");
  });

  it("should associate via title slug", () => {
    const issue = {
      title: "011-harvest: something broke",
      labels: []
    };
    expect(associateIssueWithFeature(issue)).toBe("011-harvest");
  });

  it("should return undefined if no match", () => {
    const issue = {
      title: "Random issue",
      labels: ["help-wanted"]
    };
    expect(associateIssueWithFeature(issue)).toBeUndefined();
  });
});

describe("FR-H15: Post-Ship Issue Notification", () => {
  it("US-H07: notifyIssueOpened sends Slack message", async () => {
    const issue = {
      issue_number: 123,
      feature_id: "011-harvest",
      title: "Broken link",
      body: "...",
      state: "open" as const,
      created_at: new Date().toISOString(),
      author: "tester"
    };

    await notifyIssueOpened(issue);

    expect(notifySlack).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("011-harvest")
      }),
      undefined,
      expect.any(Object)
    );
  });
});
