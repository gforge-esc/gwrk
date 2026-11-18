/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { stringify } from "yaml";
import { resolveEnforcementSkills } from "./skill-runtime.js";

it("resolves a compatible lower layer when the local policy selects another architecture", async () => {
  const root = await mkdtemp(join(tmpdir(), "gwrk-policy-layers-"));
  try {
    const name = "fixture-layout-policy";
    const local = join(root, ".gwrk/plugins/skills", name);
    const entry = join(root, "entry/skills", name);
    for (const [directory, architecture, content] of [
      [local, "layered", "Wrong local layout"],
      [entry, "hexagonal-functional", "Compatible entry layout"],
    ]) {
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, "manifest.yaml"),
        stringify({
          type: "skill",
          name,
          version: "1.0.0",
          description: "Fixture architecture policy",
          tier: "enforcement",
          scope: "all",
          language: "TypeScript",
          architectures: [architecture],
        }),
      );
      await writeFile(join(directory, "SKILL.md"), content);
    }
    await writeFile(
      join(root, ".gwrk/plugins.json"),
      JSON.stringify({ inherits: false, entries: ["entry"] }),
    );
    const rendered = await resolveEnforcementSkills(root, "all", {
      type: "nodejs",
      stack: { language: "TypeScript" },
      design: {
        architecture: "hexagonal-functional",
        principles: ["functional-core", "clean-code", "tdd"],
        templateVersion: "1.0.0",
      },
    });
    expect(rendered).toContain("Compatible entry layout");
    expect(rendered).not.toContain("Wrong local layout");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
