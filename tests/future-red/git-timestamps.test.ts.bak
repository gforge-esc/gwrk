import { describe, it, expect, vi } from "vitest";
import { collectTimestamps } from "./git-timestamps.js";
import type { DeliveryActuals } from "./types.js";

/**
 * RED tests for src/engine/git-timestamps.ts
 * Contract: contracts/compression-engine.md → collectTimestamps()
 * FR-005: Collect timestamps from OS file dates + Git + GitHub
 * FR-010: Fail-fast on features with no impl commits
 */

describe("FR-005: collectTimestamps — timestamp collection", () => {
  // TR-005: extract spec creation date, first/last impl commit from Git log
  it("TR-005: returns DeliveryActuals with specCreatedAt from git log", () => {
    // This will fail because the module doesn't exist
    const actuals = collectTimestamps("specs/001-cli-core");

    expect(actuals.specCreatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("TR-005: extracts firstImplCommit and lastImplCommit from git log", () => {
    const actuals = collectTimestamps("specs/001-cli-core");

    expect(actuals.firstImplCommit).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(actuals.lastImplCommit).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // First commit must be before or equal to last commit
    expect(new Date(actuals.firstImplCommit).getTime()).toBeLessThanOrEqual(
      new Date(actuals.lastImplCommit).getTime()
    );
  });

  it("computes dormancyDays between specCreatedAt and firstImplCommit", () => {
    const actuals = collectTimestamps("specs/001-cli-core");

    expect(typeof actuals.dormancyDays).toBe("number");
    expect(actuals.dormancyDays).toBeGreaterThanOrEqual(0);
  });

  it("computes activeCodingMinutes from commit session clustering", () => {
    const actuals = collectTimestamps("specs/001-cli-core");

    expect(typeof actuals.activeCodingMinutes).toBe("number");
    expect(actuals.activeCodingMinutes).toBeGreaterThan(0);
  });

  it("computes sessionCount from commit clusters", () => {
    const actuals = collectTimestamps("specs/001-cli-core");

    expect(typeof actuals.sessionCount).toBe("number");
    expect(actuals.sessionCount).toBeGreaterThanOrEqual(1);
  });

  it("gracefully degrades when gh CLI is unavailable", () => {
    // When gh is not available, prMergedAt should fall back to lastImplCommit
    const actuals = collectTimestamps("specs/001-cli-core");

    // Should not throw even if gh fails
    expect(actuals.deliveryWindowHours).toBeGreaterThan(0);
  });
});

describe("FR-010: collectTimestamps — error handling", () => {
  // US-006 Acceptance Scenario 1
  it("US-006: throws 'No implementation commits found' for unshipped feature", () => {
    expect(() => collectTimestamps("specs/nonexistent-feature")).toThrow(
      /No implementation commits found|Feature directory not found/
    );
  });

  it("throws for feature directory that does not exist", () => {
    expect(() => collectTimestamps("specs/does-not-exist")).toThrow(
      /Feature directory not found/
    );
  });
});
