/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import type { StoryEstimate } from "./types.js";

/**
 * Extracts User Stories from a markdown specification.
 * Matches headers like: `### US-001 - Title [5 SP, TS, PE]`
 */
export function extractStories(featureDir: string): StoryEstimate[] {
  const specPath = path.join(featureDir, "spec.md");
  if (!fs.existsSync(specPath)) {
    throw new Error(
      `spec.md not found for feature '${path.basename(featureDir)}'`,
    );
  }

  const content = fs.readFileSync(specPath, "utf-8");
  const lines = content.split("\n");
  const stories: StoryEstimate[] = [];

  // Match headers: ### US-001 - Title text [optional tags]
  // Or without the dash: ### US-001 Title
  // Or with colon: ### US-001: Title
  const storyRegex = /^#{2,4}\s+(US-\d+[a-z]?)(?:[:\s]+(?:-|—)?[:\s]*|\s+)(.*?)$/i;

  // Extract tracking brackets like [5 SP, TS, PE] or (Priority: P0, 5 SP)
  const bracketsRegex = /[\[\(](.*?)[\]\)]$/;

  for (const line of lines) {
    const match = line.match(storyRegex);
    if (!match) continue;

    const storyId = match[1]?.toUpperCase();
    let rawTitle = match[2]?.trim();
    let sp = 0;
    const roles: string[] = [];

    let priority: string | undefined;

    const bracketMatch = rawTitle.match(bracketsRegex);
    if (bracketMatch?.[1]) {
      const tagsStr = bracketMatch[1];
      // Remove the brackets from the title
      rawTitle = rawTitle.replace(bracketMatch[0], "").trim();

      // Extract SP
      const spMatch = tagsStr.match(/(\d+(?:\.\d+)?)\s*SP/i);
      if (spMatch?.[1]) {
        sp = Number.parseFloat(spMatch[1]);
      }

      // Extract Priority (P0, P1, P2)
      const priorityMatch = tagsStr.match(/P[0-2]/i);
      if (priorityMatch) {
        priority = priorityMatch[0].toUpperCase();
      }

      // Extract known roles (RE, TS, PM, PE, DE)
      const knownRoles = ["RE", "TS", "PM", "PE", "DE"];
      const tokens = tagsStr.split(/[\s,]+/);
      for (const token of tokens) {
        const upperToken = token.toUpperCase();
        if (knownRoles.includes(upperToken) && !roles.includes(upperToken)) {
          roles.push(upperToken);
        }
      }
    }

    const storyEstimate: StoryEstimate = {
      storyId,
      title: rawTitle,
      sp,
      roles,
      rawHours: 0,
      withOverhead: 0,
    };

    if (sp === 0) {
      storyEstimate.unestimated = true;
    }
    if (priority) {
      storyEstimate.priority = priority;
    }

    stories.push(storyEstimate);
  }

  if (stories.length === 0) {
    throw new Error(
      `No user stories found in spec.md for '${path.basename(featureDir)}'`,
    );
  }

  return stories;
}
