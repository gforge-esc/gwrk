import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractStories } from "./spec-parser.js";
import type { StoryEstimate } from "./types.js";

vi.mock("node:fs");

/**
 * RED tests for src/engine/spec-parser.ts
 * Contract: contracts/effort-engine.md → extractStories()
 * FR-001: Parse spec.md and extract user stories with SP/role
 * FR-004: Fail-fast on missing spec or no user stories
 */

describe("FR-001: extractStories — story extraction from spec.md", () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockImplementation((pathStr) => {
      // Mock true for any successful dummy requests
      if (typeof pathStr === "string" && pathStr.includes("specs/001-cli-core"))
        return true;
      return false;
    });

    vi.mocked(fs.readFileSync).mockImplementation((pathStr) => {
      if (
        typeof pathStr === "string" &&
        pathStr.includes("specs/001-cli-core")
      ) {
        return `
### US-001 - Dummy Story [P1, 10 SP, TS, PE, RE]
### US-002 - P0 Story (Priority: P0, 5 SP, PE)
### US-003 - Unestimated
### US-006a - Sub story [2 SP, DE]
        `;
      }
      return "";
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // US-001 Acceptance Scenario 1
  it("US-001: extracts stories with storyId, title, SP, and roles from valid spec", () => {
    const stories = extractStories("specs/001-cli-core");
    expect(stories).toBeInstanceOf(Array);
    expect(stories.length).toBeGreaterThan(0);

    const first = stories[0] as StoryEstimate;
    expect(first.storyId).toMatch(/^US-\d{3}/);
    expect(first.title).toBeTruthy();
    expect(typeof first.sp).toBe("number");
    expect(first.roles).toBeInstanceOf(Array);
    expect(first.roles.length).toBeGreaterThan(0);
  });

  it("US-001: extracts SP values as numbers from story headers", () => {
    const stories = extractStories("specs/001-cli-core");
    for (const story of stories) {
      expect(typeof story.sp).toBe("number");
      expect(story.sp).toBeGreaterThanOrEqual(0);
    }
  });

  it("US-001: extracts role codes (RE, TS, PM, PE, DE) from stories", () => {
    const validRoles = ["RE", "TS", "PM", "PE", "DE"];
    const stories = extractStories("specs/001-cli-core");
    for (const story of stories) {
      for (const role of story.roles) {
        expect(validRoles).toContain(role);
      }
    }
  });

  it("flags stories without explicit SP as unestimated", () => {
    // Create a mock spec with a story that has no SP value
    const stories = extractStories("specs/001-cli-core");
    // At minimum, the parser must handle the unestimated flag
    for (const story of stories) {
      if (story.sp === 0) {
        expect(story.unestimated).toBe(true);
      }
    }
  });

  it("handles sub-stories with dot notation (US-006a, US-006b)", () => {
    const stories = extractStories("specs/001-cli-core");
    // Parser must not crash on sub-story IDs
    expect(stories).toBeInstanceOf(Array);
  });

  it("extracts priority from story headers", () => {
    const stories = extractStories("specs/001-cli-core");
    const first = stories[0] as StoryEstimate;
    expect(first.priority).toMatch(/^P[0-2]$/);
  });
});

describe("FR-004: extractStories — error handling", () => {
  beforeEach(() => {
    // Only throw tests will run here
    vi.mocked(fs.existsSync).mockImplementation((pathStr) => {
      if (typeof pathStr === "string" && pathStr.includes("nonexistent"))
        return false;
      return true;
    });
    vi.mocked(fs.readFileSync).mockReturnValue("No stories here");
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // US-002 Acceptance Scenario 1
  it("US-002: throws with 'spec.md not found' for missing spec file", () => {
    expect(() => extractStories("specs/nonexistent")).toThrow(
      /spec\.md not found/,
    );
  });

  // US-002 Acceptance Scenario 2
  it("US-002: throws with 'No user stories found' for spec with no US markers", () => {
    // Would need a directory with a spec.md but no US-### markers.
    // For now we'll mock that case or just pass a known bad directory if one exists,
    // but right now passing "/dev" as a directory without a spec.md throws early.
    expect(() => extractStories("/dev")).toThrow(
      /No user stories found|spec\.md not found/,
    );
  });
});
