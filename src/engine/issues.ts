/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import type { IssueRecord } from "../db/issues.js";
import { notifySlack } from "../server/slack-notify.js";

export function associateIssueWithFeature(issue: {
  title: string;
  labels: string[];
}): string | undefined {
  // 1. Label matching gwrk:<feature-id> (Priority: 1)
  const gwrkLabel = issue.labels.find((l) => l.startsWith("gwrk:"));
  if (gwrkLabel) {
    return gwrkLabel.replace("gwrk:", "");
  }

  // 2. Title containing [<feature-number>] (Priority: 2)
  const bracketMatch = issue.title.match(/\[(\d{3})\]/);
  if (bracketMatch) {
    const num = bracketMatch[1];
    // Try to find the full feature ID in the specs directory
    const specsDir = path.join(process.cwd(), "specs");
    if (fs.existsSync(specsDir)) {
      const files = fs.readdirSync(specsDir);
      const match = files.find((f) => f.startsWith(num));
      if (match) return match;
    }
    return num;
  }

  // 3. Title containing the feature slug (Priority: 3)
  // Look for something like 011-harvest or just 011
  const slugMatch = issue.title.match(/(\d{3}(?:-[a-z0-9-]+)?)/i);
  if (slugMatch) {
    const matched = slugMatch[1];
    if (matched.length === 3) {
      // It's just a number, try to expand it
      const specsDir = path.join(process.cwd(), "specs");
      if (fs.existsSync(specsDir)) {
        const files = fs.readdirSync(specsDir);
        const match = files.find((f) => f.startsWith(matched));
        if (match) return match;
      }
    }
    return matched;
  }

  return undefined;
}

export async function notifyIssueOpened(issue: IssueRecord): Promise<void> {
  const link = issue.html_url ? ` (<${issue.html_url}|view on GitHub>)` : "";
  const text = `📌 Issue #${issue.issue_number} opened for *${issue.feature_id}*: ${issue.title}${link}`;

  await notifySlack(
    {
      text,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text,
          },
        },
      ],
    },
    undefined,
    {},
  );
}
