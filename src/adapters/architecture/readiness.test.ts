/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readArchitectureReadiness } from "./readiness.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, readdir: vi.fn(fs.readdir) };
});

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
async function context(content = target) {
  const targetHash = createHash("sha256").update(content).digest("hex");
  await put(".gwrk/architecture.md", content);
  await put(
    ".gwrk/context-manifest.json",
    JSON.stringify({
      version: 1,
      files: { ".gwrk/architecture.md": targetHash },
      decisions: {},
    }),
  );
  await put(
    ".gwrk/decisions/index.md",
    "# Decisions\nStatus remains Proposed.\n",
  );
  return targetHash;
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
  vi.unstubAllEnvs();
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
  it("detects target byte changes that decode to the same text", async () => {
    const targetHash = await context(`${target}\uFFFD`);
    await report("docs/architecture/assessments/2026-11-18", {
      generatedAt: "2026-11-18T10:00:00Z",
      targetHash,
    });
    await writeFile(
      join(root, ".gwrk/architecture.md"),
      Buffer.concat([Buffer.from(target), Buffer.from([0xff])]),
    );

    expect(await readArchitectureReadiness(root, design)).toMatchObject({
      context: {
        status: "incomplete",
        issues: [{ path: ".gwrk/architecture.md", kind: "hash-mismatch" }],
      },
      assessment: { latest: { targetMatch: "differs" } },
    });
  });
  it("reports an incomplete context when the manifest omits its decision map", async () => {
    await context();
    await put(
      ".gwrk/context-manifest.json",
      JSON.stringify({
        version: 1,
        files: { ".gwrk/architecture.md": digest },
      }),
    );

    expect((await readArchitectureReadiness(root, design))?.context).toEqual({
      status: "incomplete",
      issues: [{ path: ".gwrk/context-manifest.json", kind: "invalid" }],
    });
  });
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
  it.each([
    { GIT_LITERAL_PATHSPECS: "1" },
    { GIT_GLOB_PATHSPECS: "1", GIT_NOGLOB_PATHSPECS: "1" },
    { GIT_LITERAL_PATHSPECS: "1", GIT_ICASE_PATHSPECS: "1" },
  ])(
    "finds custom evidence under inherited Git pathspec controls %j",
    async (controls) => {
      execFileSync("git", ["init", "--quiet", root]);
      await report("custom", { generatedAt: "2026-11-19T10:00:00Z" });
      for (const [key, value] of Object.entries(controls))
        vi.stubEnv(key, value);
      expect(
        (await readArchitectureReadiness(root))?.assessment.latest?.reportPath,
      ).toBe("custom/report.md");
    },
  );

  it("finds custom evidence when unrelated Git paths exceed the inventory buffer", async () => {
    execFileSync("git", ["init", "--quiet", root]);
    const blob = execFileSync(
      "git",
      ["-C", root, "hash-object", "-w", "--stdin"],
      { encoding: "utf8", input: "" },
    ).trim();
    // These paths alone exceed the 10 MiB inventory buffer.
    const pathPrefix = `unrelated/${"x".repeat(240)}`;
    const entries = Array.from(
      { length: 45_000 },
      (_, index) => `100644 ${blob}\t${pathPrefix}${index}\0`,
    );
    execFileSync("git", ["-C", root, "update-index", "-z", "--index-info"], {
      input: entries.join(""),
    });
    await report("custom", { generatedAt: "2026-11-19T10:00:00Z" });

    expect(
      (await readArchitectureReadiness(root))?.assessment.latest?.reportPath,
    ).toBe("custom/report.md");
  });
  it("links a Git-staged assessment at the checkout root", async () => {
    const generatedAt = "2026-11-19T10:00:00Z";
    execFileSync("git", ["init", "--quiet", root]);
    await report(".", { generatedAt });
    execFileSync("git", [
      "-C",
      root,
      "add",
      "--",
      "report.md",
      "assessment.json",
      "provenance.json",
    ]);
    const result = await readArchitectureReadiness(root);
    expect(result?.assessment.latest?.reportPath).toBe("report.md");
    expect(result?.assessment.latest).toMatchObject({
      generatedAt,
      scope: {
        inspected: assessment.inspected,
        limitations: assessment.limitations,
      },
    });
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

  it("keeps the latest archive timestamp when a dated symlink is listed last", async () => {
    const archive = "docs/architecture/assessments";
    const later = `${archive}/2026-11-18T12-00-00-000Z`;
    const alias = "2026-11-18_legacy";
    await put(
      `${archive}/2026-11-18T10-00-00-000Z/report.md`,
      "# Earlier report\n",
    );
    await put(`${later}/report.md`, "# Later report\n");
    await symlink(join(root, later), join(root, archive, alias));
    const fs =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    vi.mocked(readdir).mockImplementationOnce(async (path, options) => {
      const entries = await fs.readdir(path, options);
      return entries.sort(
        (first, second) =>
          Number(first.name.toString() === alias) -
          Number(second.name.toString() === alias),
      );
    });

    expect(
      (await readArchitectureReadiness(root))?.assessment.latest?.reportPath,
    ).toBe(`${later}/report.md`);
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
