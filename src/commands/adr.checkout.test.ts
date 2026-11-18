/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { scaffold } from "../engine/adr-scaffold.js";
import { adrCommandHandler } from "./adr.js";
let root: string;
let alpha: string;
let beta: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "gwrk-adr-checkout-"));
  alpha = join(root, "alpha"); beta = join(root, "beta");
  for (const dir of [alpha, beta]) {
    await mkdir(join(dir, "docs"), { recursive: true });
    await writeFile(join(dir, ".gwrkrc.json"), JSON.stringify({ project: { name: "fixture" } }));
  }
  alpha = await realpath(alpha);
  beta = await realpath(beta);
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
it("carries the dispatched checkout boundary into authoring before corpus writes", async () => {
  await mkdir(join(beta, "docs/decisions"));
  await symlink(join(beta, "docs/decisions"), join(alpha, "docs/decisions"), "dir");
  vi.stubEnv("GWRK_ADR_CHECKOUT_ROOT", alpha);
  await expect(adrCommandHandler({ cwd: alpha, target: "Scoped decision" })).rejects.toThrow(/checkout/i);
  expect(await readdir(join(beta, "docs/decisions"))).toEqual([]);
});
it("denies authoring before writing when the index destination escapes", async () => {
  await mkdir(join(alpha, "docs/decisions"));
  await mkdir(join(alpha, ".gwrk"));
  await symlink(beta, join(alpha, ".gwrk/decisions"), "dir");
  vi.stubEnv("GWRK_ADR_CHECKOUT_ROOT", alpha);
  await expect(adrCommandHandler({ cwd: alpha, target: "Scoped decision" })).rejects.toThrow(/checkout/i);
  expect(await readdir(join(alpha, "docs/decisions"))).toEqual([]);
  expect(await readdir(beta)).toEqual([".gwrkrc.json", "docs"]);
});
it("keeps direct scaffold writes within the dispatched checkout", async () => {
  await mkdir(join(beta, "docs/decisions"));
  await symlink(join(beta, "docs/decisions"), join(alpha, "docs/decisions"), "dir");
  vi.stubEnv("GWRK_ADR_CHECKOUT_ROOT", alpha);
  await expect(scaffold("Scoped decision", { cwd: alpha })).rejects.toThrow(/checkout/i);
  expect(await readdir(join(beta, "docs/decisions"))).toEqual([]);
});
it("authors and indexes a local decision under the carried checkout boundary", async () => {
  vi.stubEnv("GWRK_ADR_CHECKOUT_ROOT", alpha);
  const result = await adrCommandHandler({ cwd: alpha, target: "Scoped decision" });
  expect(await readFile(result, "utf8")).toContain("Scoped decision");
  expect(await readFile(join(alpha, ".gwrk/decisions/index.md"), "utf8")).toContain("ADR-001");
});
