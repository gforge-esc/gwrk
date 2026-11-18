/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installArchitectureContext } from "../../adapters/architecture/context-files.js";
import {
  contextMarkdown,
  resolveDesign,
} from "../../domain/architecture-context.js";
import { composeEffectivePolicy } from "../../domain/policy-selection.js";

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

  it("renders the projected compatibility gap in a two-argument call", () => {
    const design = resolveDesign({ architecture: "hexagonal-functional" });
    const stack = { language: "TypeScript", framework: "Django" };
    const input = {
      projectName: "mixed-choice",
      design,
      ...stack,
      decisionsDir: "docs/decisions",
      effectivePolicy: composeEffectivePolicy({
        profile: { type: "nodejs", design, stack },
        candidates: [],
      }),
    };

    const context = contextMarkdown(input, []);

    expect(context).toContain(
      "## Policy gaps\n\n- No compatible policy found for framework Django.",
    );
    expect(context).not.toContain("Keep Django ORM models and transactions");
  });

  it("preserves the legacy render bytes when the projected policy has no gaps", () => {
    const design = resolveDesign({ architecture: "hexagonal-functional" });
    const stack = { language: "Python", framework: "FastAPI" };
    const input = {
      projectName: "compatible-choice",
      design,
      ...stack,
      decisionsDir: "docs/decisions",
    };
    const decisions = ["docs/decisions/ADR-001-desired-architecture.md"];
    const effectivePolicy = composeEffectivePolicy({
      profile: { type: "python", design, stack },
      candidates: [],
    });

    expect(effectivePolicy.gaps).toEqual([]);
    expect(contextMarkdown({ ...input, effectivePolicy }, decisions)).toBe(
      contextMarkdown(input, decisions),
    );
  });

  it("reports an incompatible framework choice without rendering another language's binding", async () => {
    const root = await fixture();
    const result = await installArchitectureContext(root, {
      projectName: "mixed-choice",
      design: resolveDesign({ architecture: "hexagonal-functional" }),
      language: "TypeScript",
      framework: "Django",
      decisionsDir: "docs/decisions",
    });
    const context = await fs.readFile(
      path.join(root, ".gwrk/architecture.md"),
      "utf8",
    );
    expect(result.conformance).toBe("unassessed");
    expect(context).toContain("## Policy gaps");
    expect(context).toContain("TypeScript");
    expect(context).toContain("Django");
    expect(context).not.toContain("Keep Django ORM models and transactions");
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

  it("updates policy gaps after installing a pack without creating another target decision", async () => {
    const root = await fixture();
    const input = {
      projectName: "portable",
      design: resolveDesign({ architecture: "hexagonal-functional" }),
      language: "Clojure",
      decisionsDir: "docs/decisions",
    };
    const first = await installArchitectureContext(root, input);
    const architecture = path.join(root, ".gwrk/architecture.md");
    expect(await fs.readFile(architecture, "utf8")).toContain("## Policy gaps");
    const pack = path.join(root, ".gwrk/plugins/skills/clojure-policy");
    await fs.mkdir(pack, { recursive: true });
    await fs.writeFile(
      path.join(pack, "manifest.yaml"),
      "type: skill\nname: clojure-policy\nversion: 1.0.0\ndescription: Clojure project policy\ntier: enforcement\nscope: all\nlanguage: Clojure\n",
    );
    await fs.writeFile(
      path.join(pack, "SKILL.md"),
      "Keep effects behind explicit ports.",
    );
    const second = await installArchitectureContext(root, input);
    expect(second.decisions).toEqual(first.decisions);
    expect(second.conflicts).toEqual([]);
    expect(await fs.readFile(architecture, "utf8")).not.toContain(
      "## Policy gaps",
    );
    expect(await fs.readdir(path.join(root, "docs/decisions"))).toHaveLength(1);
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
