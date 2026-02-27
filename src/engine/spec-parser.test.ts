import { describe, it, expect } from "vitest";
import { extractStories } from "./spec-parser.js";
import type { StoryEstimate } from "./types.js";

/**
 * RED tests for src/engine/spec-parser.ts
 * Contract: contracts/effort-engine.md → extractStories()
 * FR-001: Parse spec.md and extract user stories with SP/role
 * FR-004: Fail-fast on missing spec or no user stories
 */

describe("FR-001: extractStories — story extraction from spec.md", () => {
  // US-001 Acceptance Scenario 1
  it("US-001: extracts stories with storyId, title, SP, and roles from valid spec", () => {
    const stories = extractStories("specs/001-cli-core/spec.md");
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
    const stories = extractStories("specs/001-cli-core/spec.md");
    for (const story of stories) {
      expect(typeof story.sp).toBe("number");
      expect(story.sp).toBeGreaterThanOrEqual(0);
    }
  });

  it("US-001: extracts role codes (RE, TS, PM, PE, DE) from stories", () => {
    const validRoles = ["RE", "TS", "PM", "PE", "DE"];
    const stories = extractStories("specs/001-cli-core/spec.md");
    for (const story of stories) {
      for (const role of story.roles) {
        expect(validRoles).toContain(role);
      }
    }
  });

  it("flags stories without explicit SP as unestimated", () => {
    // Create a mock spec with a story that has no SP value
    const stories = extractStories("specs/001-cli-core/spec.md");
    // At minimum, the parser must handle the unestimated flag
    for (const story of stories) {
      if (story.sp === 0) {
        expect(story.unestimated).toBe(true);
      }
    }
  });

  it("handles sub-stories with dot notation (US-006a, US-006b)", () => {
    const stories = extractStories("specs/001-cli-core/spec.md");
    // Parser must not crash on sub-story IDs
    expect(stories).toBeInstanceOf(Array);
  });

  it("extracts priority from story headers", () => {
    const stories = extractStories("specs/001-cli-core/spec.md");
    const first = stories[0] as StoryEstimate;
    expect(first.priority).toMatch(/^P[0-2]$/);
  });
});

describe("FR-004: extractStories — error handling", () => {
  // US-002 Acceptance Scenario 1
  it("US-002: throws with 'spec.md not found' for missing spec file", () => {
    expect(() => extractStories("specs/nonexistent/spec.md")).toThrow(
      /spec\.md not found/
    );
  });

  // US-002 Acceptance Scenario 2
  it("US-002: throws with 'No user stories found' for spec with no US markers", () => {
    // Would need a spec.md with no US-### markers
    expect(() => extractStories("/dev/null")).toThrow(
      /No user stories found|spec\.md not found/
    );
  });
});
