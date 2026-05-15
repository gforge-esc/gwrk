import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Module does not exist yet (RED) — Phase 9: tasks verify implementation pending
import { tasksCommand } from "./tasks.js";
import { writeManifest } from "../utils/manifest.js";
import { CommandError } from "../utils/signal.js";

describe("gwrk tasks verify", () => {
  // TODO: ADR-003 — execution manifest infrastructure needed
  // tasks verify depends on writeManifest producing manifests during ship,
  // which isn't wired yet. Restore these tests when ADR-003 is implemented.
  it.todo("should pass when all completed tasks have manifests and no orphans exist");
  it.todo("should fail when a completed task is missing its manifest (regression)");
  it.todo("should fail when an orphan manifest exists for an open task");
});