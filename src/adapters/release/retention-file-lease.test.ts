/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireFlockLease } from "./retention-lock.js";

describe.skipIf(process.platform !== "linux")("kernel run lease", () => {
  it("excludes another cleanup until the holder releases", async () => {
    const root = await mkdtemp(join(tmpdir(), "gwrk-kernel-lease-"));
    let release: (() => Promise<void>) | null = null;
    try {
      release = await acquireFlockLease(join(root, ".lease"));
      expect(release).not.toBeNull();
      expect(await acquireFlockLease(join(root, ".lease"))).toBeNull();
      await release?.();
      release = null;
      release = await acquireFlockLease(join(root, ".lease"));
      expect(release).not.toBeNull();
    } finally {
      await release?.();
      await rm(root, { recursive: true, force: true });
    }
  });
  it("refuses a lease symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "gwrk-kernel-lease-"));
    try {
      await writeFile(join(root, "foreign"), "preserve");
      await symlink(join(root, "foreign"), join(root, ".lease"));
      await expect(acquireFlockLease(join(root, ".lease"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
