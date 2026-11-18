/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectProfile } from "../domain/types.js";
import * as detector from "../engine/profile-detector.js";
import * as agents from "../utils/agent.js";
import { WorkflowRuntime } from "./workflow-runtime.js";

const dispatch = agents.dispatchToAgent;
afterEach(() => vi.restoreAllMocks());

describe("governance prompt delivery", () => {
  it.each(["gwrk-specify", "gwrk-plan", "gwrk-review-code"])(
    "delivers project guidance and decision authority through %s",
    async (workflow) => {
      const root = await mkdtemp(join(tmpdir(), "gwrk-governance-delivery-"));
      try {
        await mkdir(join(root, ".gwrk/decisions"), { recursive: true });
        await writeFile(
          join(root, ".gwrk/decisions/index.md"),
          "# Decisions\n\nProposed: hexagonal target.\nDecided: preserve current adapter contract.\nSuperseded: earlier layout.\n",
        );
        await writeFile(
          join(root, ".gwrk/architecture.md"),
          "Target context. Existing code conformance remains unassessed.",
        );
        const profile: ProjectProfile = {
          type: "python",
          stack: { language: "Python", framework: "FastAPI" },
          layout: "src-layout",
        };
        vi.spyOn(detector, "detectProfile").mockResolvedValue(profile);
        let captured = "";
        const transport = vi
          .spyOn(agents, "dispatchToAgent")
          .mockImplementation(async (task) => {
            const result = await dispatch({
              ...task,
              agent: "codex",
              dryRun: true,
              quiet: true,
            });
            captured = result.stdout;
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                summary: "Captured delivery",
                verdict: "GO",
                reopenedTasks: [],
                intents: [],
              }),
              stderr: "",
              durationS: 0,
            };
          });
        await new WorkflowRuntime().executeWorkflow(
          workflow,
          "Use the project decisions.",
          { projectRoot: root, quiet: true },
        );
        expect(transport).toHaveBeenCalledOnce();
        expect(captured).toContain("<decision_authority>");
        expect(captured).toContain(
          "Proposed targets require human ratification.",
        );
        expect(captured).toContain(
          "They do not supersede Decided constraints.",
        );
        expect(captured).toContain(
          "Superseded records preserve history and lineage.",
        );
        expect(captured).toContain(
          "Existing code conformance remains unassessed.",
        );
        expect(captured).toContain("Use the project decisions.");
        if (workflow !== "gwrk-review-code") {
          expect(captured).toContain('language="Python"');
          expect(captured).not.toContain("src/application/");
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
