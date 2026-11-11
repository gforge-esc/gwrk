/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

describe("Linux release archive", () => {
  it("ships the frozen lockfile with the CLI and excludes local configuration", () => {
    const root = mkdtempSync(join(tmpdir(), "gwrk-package-test-"));
    try {
      const source = join(root, "source");
      mkdirSync(join(source, "dist"), { recursive: true });
      mkdirSync(join(source, ".gwrk"));
      mkdirSync(join(source, "deploy/linux-runner"), { recursive: true });
      copyFileSync("package.json", join(source, "package.json"));
      copyFileSync("pnpm-lock.yaml", join(source, "pnpm-lock.yaml"));
      writeFileSync(join(source, "dist/cli.js"), "// fixture");
      copyFileSync(
        "deploy/linux-runner/install-release.sh",
        join(source, "deploy/linux-runner/install-release.sh"),
      );
      writeFileSync(
        join(source, "deploy/linux-runner/.env"),
        "synthetic-secret",
      );
      for (const path of [".env", ".gwrkrc.local.json", ".gwrk/config.json"]) {
        writeFileSync(join(source, path), "synthetic-secret");
      }

      const archive = join(root, "release.tgz");
      const builder = pathToFileURL(
        resolve("scripts/release/build-linux-release.mjs"),
      ).href;
      execFileSync(process.execPath, [
        "--input-type=module",
        "-e",
        "const { packRelease } = await import(process.argv[1]); await packRelease(process.argv[2], process.argv[3]);",
        builder,
        source,
        archive,
      ]);
      const files = execFileSync("tar", ["-tzf", archive], {
        encoding: "utf8",
      }).split("\n");

      expect(files).toContain("package/dist/cli.js");
      expect(files).toContain("package/pnpm-lock.yaml");
      expect(files).toContain("package/deploy/linux-runner/install-release.sh");
      expect(files).not.toContain("package/deploy/linux-runner/.env");
      expect(files).not.toContain("package/.gwrkrc.local.json");
      expect(files).not.toContain("package/.env");
      expect(files).not.toContain("package/.gwrk/config.json");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
