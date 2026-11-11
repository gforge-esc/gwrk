/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installArchitectureContext } from "../../adapters/architecture/context-files.js";
import { resolveDesign } from "../../domain/architecture-context.js";

const roots: string[] = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gwrk-context-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0))
    await fs.rm(root, { recursive: true, force: true });
});

describe("architecture context", () => {
  it("composes architecture with language and framework without claiming conformance", () => {
    const design = resolveDesign({
      architecture: "hexagonal-functional",
      principles: ["tdd", "clean-code"],
    });
    expect(design.architecture).toBe("hexagonal-functional");
    expect(design.principles).toContain("functional-core");
  });

  it("installs portable context deterministically and preserves user instructions", async () => {
    const root = await fixture();
    await fs.writeFile(path.join(root, "AGENTS.md"), "Keep my instructions.\n");
    const input = {
      projectName: "demo",
      design: resolveDesign({ architecture: "hexagonal-functional" }),
      language: "Python",
      framework: "FastAPI",
      decisionsDir: "docs/adr",
    };
    const first = await installArchitectureContext(root, input);
    const before = await fs.readFile(
      path.join(root, ".gwrk/architecture.md"),
      "utf8",
    );
    const second = await installArchitectureContext(root, input);
    expect(first.status).toBe("ready");
    expect(second.conflicts).toEqual([]);
    expect(second.decisions).toEqual(first.decisions);
    expect(
      await fs.readFile(path.join(root, ".gwrk/architecture.md"), "utf8"),
    ).toBe(before);
    expect(before).toContain("FastAPI");
    expect(before).toContain("unassessed");
    expect(await fs.readFile(path.join(root, "AGENTS.md"), "utf8")).toContain(
      "Keep my instructions.",
    );
    expect(first.decisions.every((file) => file.startsWith("docs/adr/"))).toBe(
      true,
    );
    for (const file of first.decisions)
      expect(await fs.readFile(path.join(root, file), "utf8")).toContain(
        "**Status:** Proposed",
      );
    for (const file of [
      ".gwrk/.claude-plugin/marketplace.json",
      ".gwrk/plugins/gwrk/.claude-plugin/plugin.json",
      ".gwrk/plugins/gwrk/gemini-extension.json",
      ".gwrk/plugins/gwrk/skills/gwrk-assess/SKILL.md",
      "CLAUDE.md",
      "GEMINI.md",
    ]) {
      expect((await fs.stat(path.join(root, file))).isFile()).toBe(true);
    }
  });

  it("preserves edited generated files and reports incomplete context", async () => {
    const root = await fixture();
    const input = {
      projectName: "demo",
      design: resolveDesign({ architecture: "hexagonal-functional" }),
      decisionsDir: "docs/decisions",
    };
    await installArchitectureContext(root, input);
    await fs.appendFile(
      path.join(root, ".gwrk/architecture.md"),
      "\nHuman exception.\n",
    );
    const result = await installArchitectureContext(root, input);
    expect(result.status).toBe("incomplete");
    expect(result.conflicts).toContain(".gwrk/architecture.md");
    expect(
      await fs.readFile(path.join(root, ".gwrk/architecture.md"), "utf8"),
    ).toContain("Human exception.");
  });

  it("never overwrites an existing accepted decision", async () => {
    const root = await fixture();
    await fs.mkdir(path.join(root, "docs/decisions"), { recursive: true });
    const accepted =
      "# ADR-001: Existing architecture\n\n> **Status:** Decided\n> **Decision:** Keep current policy.\n";
    await fs.writeFile(
      path.join(root, "docs/decisions/ADR-001-existing.md"),
      accepted,
    );
    const result = await installArchitectureContext(root, {
      projectName: "demo",
      design: resolveDesign({ architecture: "hexagonal-functional" }),
      decisionsDir: "docs/decisions",
    });
    expect(
      await fs.readFile(
        path.join(root, "docs/decisions/ADR-001-existing.md"),
        "utf8",
      ),
    ).toBe(accepted);
    expect(result.decisions[0]).toMatch(/ADR-002/);
  });
});
