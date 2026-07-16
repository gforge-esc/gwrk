/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildProjectContext } from "./agent-context.js";

describe("agent-context", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-agent-ctx-"));
    const featureDir = path.join(projectRoot, "specs", "003-slack");
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(path.join(featureDir, "spec.md"), "# Slack spec\n");
    fs.writeFileSync(path.join(featureDir, "plan.md"), "# Slack plan\n");
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it("should assemble deep project context including specs, plans, and tasks (Phase 2)", async () => {
    const context = await buildProjectContext(projectRoot);

    expect(context).toContain("003-slack");
    expect(context).toContain("spec.md");
    expect(context).toContain("plan.md");
    // Deep context should include some content, not just filenames
    expect(context.length).toBeGreaterThan(100);
  });
});
