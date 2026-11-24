/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { CommandError } from "../utils/signal.js";
import {
  computePolicySkillDigest,
  readProjectPolicyLock,
  verifyProjectPolicyLock,
} from "./policy-lock.js";
let root: string;
const manifest = {
  type: "skill",
  name: "architecture",
  version: "1.0.0",
  description: "Inward dependencies",
  tier: "enforcement",
} as const;
const text = "# Rules\n\n- Depend inward.\n";
const pin = () => ({
  name: "architecture",
  source: "project-local" as const,
  version: "1.0.0",
  sha256: computePolicySkillDigest(manifest, text),
});
const lock = () => ({
  version: 1 as const,
  gwrkVersion: "2.0.0",
  skills: [pin()],
});
const candidate = () => ({
  name: "architecture",
  source: "project-local" as const,
  manifest,
  content: text,
});
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "gwrk-policy-lock-"));
});
afterEach(async () => rm(root, { recursive: true, force: true }));
async function save(value: unknown) {
  await mkdir(join(root, ".gwrk"), { recursive: true });
  await writeFile(join(root, ".gwrk/policy-lock.json"), JSON.stringify(value));
}
it("leaves an absent lock absent without creating directories", async () => {
  expect(await readProjectPolicyLock(root)).toBeUndefined();
  expect(await readdir(root)).toEqual([]);
});
it("reads a tracked lock without mutating its bytes", async () => {
  await save(lock());
  const before = await readFile(join(root, ".gwrk/policy-lock.json"));
  expect(await readProjectPolicyLock(root)).toEqual(lock());
  expect(await readFile(join(root, ".gwrk/policy-lock.json"))).toEqual(before);
});
it.each(["json", "version", "duplicate", "unknown field", "digest"])(
  "rejects %s with the tracked path and repair guidance",
  async (kind) => {
    const value = lock();
    await save(
      kind === "version"
        ? { ...value, version: 2 }
        : kind === "duplicate"
          ? { ...value, skills: [pin(), pin()] }
          : kind === "unknown field"
            ? { ...value, extra: true }
            : kind === "digest"
              ? { ...value, skills: [{ ...pin(), sha256: "invalid" }] }
              : value,
    );
    if (kind === "json")
      await writeFile(join(root, ".gwrk/policy-lock.json"), "{broken");
    await expect(readProjectPolicyLock(root)).rejects.toThrow(
      /policy-lock\.json.*review/i,
    );
  },
);
it("hashes sorted object keys and LF text while preserving array order and parsed fields", () => {
  const a = { ...manifest, selectors: { z: 2, a: ["x", "y"] } };
  const b = { selectors: { a: ["x", "y"], z: 2 }, ...manifest };
  expect(computePolicySkillDigest(a, text)).toBe(
    computePolicySkillDigest(b, text.replace(/\n/g, "\r\n")),
  );
  expect(computePolicySkillDigest(a, text)).not.toBe(
    computePolicySkillDigest(
      { ...b, selectors: { a: ["y", "x"], z: 2 } },
      text,
    ),
  );
  expect(computePolicySkillDigest(manifest, text)).not.toBe(
    computePolicySkillDigest({ ...manifest, disabled: false }, text),
  );
  const expected = createHash("sha256")
    .update(
      JSON.stringify([
        {
          description: manifest.description,
          name: manifest.name,
          tier: manifest.tier,
          type: manifest.type,
          version: manifest.version,
        },
        text,
      ]),
    )
    .digest("hex");
  expect(computePolicySkillDigest(manifest, text)).toBe(expected);
});
it("returns only pinned candidates from the declared layer in original discovery order", () => {
  const selected = candidate();
  const global = { ...selected, source: "global" as const };
  expect(verifyProjectPolicyLock(lock(), [global, selected], "2.0.0")).toEqual([
    selected,
  ]);
  expect(
    verifyProjectPolicyLock(
      { ...lock(), skills: [] },
      [global, selected],
      "2.0.0",
    ),
  ).toEqual([]);
});
it.each([
  "gwrk version",
  "layer",
  "skill version",
  "digest",
  "disabled",
  "missing text",
])("rejects %s before a candidate can reach composition", (kind) => {
  const selected = candidate();
  const changed =
    kind === "layer"
      ? { ...selected, source: "global" as const }
      : kind === "skill version"
        ? { ...selected, manifest: { ...manifest, version: "2.0.0" } }
        : kind === "digest"
          ? { ...selected, content: `${text}Changed` }
          : kind === "disabled"
            ? { ...selected, manifest: { ...manifest, disabled: true } }
            : kind === "missing text"
              ? { ...selected, content: undefined }
              : selected;
  expect(() =>
    verifyProjectPolicyLock(
      lock(),
      [changed],
      kind === "gwrk version" ? "3.0.0" : "2.0.0",
    ),
  ).toThrow(/policy-lock\.json.*(provision|review)/i);
});

it("hashes the original parsed manifest rather than computed enablement metadata", () => {
  const selected = {
    ...candidate(),
    manifest: { ...manifest, disabled: false },
    sourceManifest: manifest,
  };
  expect(verifyProjectPolicyLock(lock(), [selected], "2.0.0")).toEqual([
    selected,
  ]);
});

it("does not treat a dangling tracked lock link as absence", async () => {
  await mkdir(join(root, ".gwrk"));
  await symlink(
    join(root, "missing.json"),
    join(root, ".gwrk/policy-lock.json"),
  );
  await expect(readProjectPolicyLock(root)).rejects.toThrow(
    /policy-lock\.json.*review/i,
  );
});

it("wraps non-directory and unreadable .gwrk lock probe failures as CommandError", async () => {
  await writeFile(join(root, ".gwrk"), "not-a-directory");
  const enotdir = await readProjectPolicyLock(root).catch(
    (error: unknown) => error,
  );
  expect(enotdir).toBeInstanceOf(CommandError);
  expect((enotdir as Error).message).toMatch(/policy-lock\.json.*review/i);

  await rm(join(root, ".gwrk"), { force: true });
  if (process.getuid?.() !== 0) {
    const gwrkDir = join(root, ".gwrk");
    await mkdir(gwrkDir);
    await chmod(gwrkDir, 0o000);
    try {
      const eacces = await readProjectPolicyLock(root).catch(
        (error: unknown) => error,
      );
      expect(eacces).toBeInstanceOf(CommandError);
      expect((eacces as Error).message).toMatch(/policy-lock\.json.*review/i);
    } finally {
      await chmod(gwrkDir, 0o755);
    }
  }
});
