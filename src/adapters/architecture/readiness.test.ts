/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readArchitectureReadiness } from "./readiness.js";

let root: string;
const target = "# Target\nSelected context without a conformance claim.\n";
const digest = createHash("sha256").update(target).digest("hex");
const design = {
  architecture: "hexagonal-functional",
  principles: ["functional-core" as const],
  templateVersion: "1.0.0" as const,
};
const assessment = {
  overview: "Scoped review",
  inspected: ["src/domain"],
  limitations: ["Adapters unreviewed"],
  findings: [],
  features: [],
  reconciliation: [],
};
async function put(path: string, content: string) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}
async function context() {
  await put(".gwrk/architecture.md", target);
  await put(
    ".gwrk/context-manifest.json",
    JSON.stringify({
      version: 1,
      files: { ".gwrk/architecture.md": digest },
      decisions: {},
    }),
  );
  await put(
    ".gwrk/decisions/index.md",
    "# Decisions\nStatus remains Proposed.\n",
  );
}
async function report(directory: string, provenance?: Record<string, unknown>) {
  await put(`${directory}/report.md`, "# Scoped report\n");
  await put(`${directory}/assessment.json`, JSON.stringify(assessment));
  if (provenance)
    await put(`${directory}/provenance.json`, JSON.stringify(provenance));
}
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "gwrk-readiness-")));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("repository architecture readiness", () => {
  it("returns no architecture field without selection or evidence", async () => {
    expect(await readArchitectureReadiness(root)).toBeUndefined();
  });
  it("keeps a selected target separate from missing context and assessment", async () => {
    expect(await readArchitectureReadiness(root, design)).toEqual({
      target: { selection: design, path: null },
      context: { status: "missing", issues: expect.any(Array) },
      assessment: { latest: null },
    });
  });
  it("reports matching managed context without claiming code conformance", async () => {
    await context();
    const result = await readArchitectureReadiness(root, design);
    expect(result?.context).toEqual({ status: "ready", issues: [] });
    expect(result?.target.path).toBe(".gwrk/architecture.md");
    expect(result?.assessment.latest).toBeNull();
    expect(result).not.toHaveProperty("conformance");
  });
  it.each(["changed target", "invalid manifest", "missing index"])(
    "reports incomplete context for %s",
    async (defect) => {
      await context();
      if (defect === "changed target")
        await put(".gwrk/architecture.md", `${target}Edited\n`);
      if (defect === "invalid manifest")
        await put(".gwrk/context-manifest.json", "{bad json");
      if (defect === "missing index")
        await rm(join(root, ".gwrk/decisions/index.md"));
      const result = await readArchitectureReadiness(root, design);
      expect(result?.context.status).toBe("incomplete");
      expect(result?.context.issues).toContainEqual(
        expect.objectContaining({
          kind:
            defect === "changed target"
              ? "hash-mismatch"
              : defect === "invalid manifest"
                ? "invalid"
                : "missing",
        }),
      );
    },
  );
  it("links a dated Markdown-only report without inventing provenance or scope", async () => {
    await put(
      "docs/architecture/assessments/2026-11-18/report.md",
      "# Prior report\n",
    );
    const result = await readArchitectureReadiness(root);
    expect(result?.assessment.latest).toEqual({
      reportPath: "docs/architecture/assessments/2026-11-18/report.md",
      generatedAt: null,
      revision: null,
      targetMatch: "unknown",
      scope: null,
    });
  });
  it("orders valid provenance before archive date and preserves scoped evidence", async () => {
    await context();
    await report("docs/architecture/assessments/2026-11-18", {
      generatedAt: "2026-11-18T10:00:00Z",
      revision: "old",
      targetHash: digest,
    });
    await report("docs/architecture/assessments/2026-11-17", {
      generatedAt: "2026-11-19T10:00:00Z",
      revision: "new",
      targetHash: digest,
    });
    const result = await readArchitectureReadiness(root, design);
    expect(result?.assessment.latest).toMatchObject({
      reportPath: "docs/architecture/assessments/2026-11-17/report.md",
      revision: "new",
      targetMatch: "matches",
      scope: {
        inspected: ["src/domain"],
        limitations: ["Adapters unreviewed"],
      },
    });
  });
  it("finds custom tracked evidence and ignores untracked ignored output", async () => {
    execFileSync("git", ["init", "--quiet", root]);
    await put(".gitignore", "ignored/\n");
    await report("ignored/latest", { generatedAt: "2026-11-20T10:00:00Z" });
    await report("custom review/evidence", {
      generatedAt: "2026-11-19T10:00:00Z",
    });
    execFileSync("git", ["-C", root, "add", "custom review"]);
    const result = await readArchitectureReadiness(root);
    expect(result?.assessment.latest?.reportPath).toBe(
      "custom review/evidence/report.md",
    );
  });
  it("keeps the last readable report when a newer output is empty", async () => {
    await put(
      "docs/architecture/assessments/2026-11-17/report.md",
      "# Complete report\n",
    );
    await put("docs/architecture/assessments/2026-11-18/report.md", "");
    expect(
      (await readArchitectureReadiness(root))?.assessment.latest?.reportPath,
    ).toBe("docs/architecture/assessments/2026-11-17/report.md");
  });

  it("keeps custom evidence with a valid timestamp and unknown optional provenance", async () => {
    execFileSync("git", ["init", "--quiet", root]);
    await report("custom", {
      generatedAt: "2026-11-19T10:00:00Z",
      revision: 42,
      targetHash: "unavailable",
    });
    expect(
      (await readArchitectureReadiness(root))?.assessment.latest,
    ).toMatchObject({
      reportPath: "custom/report.md",
      generatedAt: "2026-11-19T10:00:00Z",
      revision: null,
      targetMatch: "unknown",
    });
  });

  it("finds default CLI timestamp directories without Git or provenance", async () => {
    await put(
      "docs/architecture/assessments/2026-11-18T10-00-00-000Z/report.md",
      "# Earlier report\n",
    );
    await put(
      "docs/architecture/assessments/2026-11-18T12-00-00-000Z/report.md",
      "# Later report\n",
    );
    expect(
      (await readArchitectureReadiness(root))?.assessment.latest?.reportPath,
    ).toBe("docs/architecture/assessments/2026-11-18T12-00-00-000Z/report.md");
  });

  it("does not inspect report directories outside the project", async () => {
    const external = await realpath(
      await mkdtemp(join(tmpdir(), "gwrk-outside-readiness-")),
    );
    try {
      await writeFile(join(external, "report.md"), "# Foreign\n");
      await mkdir(join(root, "docs/architecture/assessments"), {
        recursive: true,
      });
      await symlink(
        external,
        join(root, "docs/architecture/assessments/2026-11-18"),
      );
      expect(await readArchitectureReadiness(root)).toBeUndefined();
    } finally {
      await rm(external, { recursive: true, force: true });
    }
  });
});
