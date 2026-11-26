/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

describe("Linux release archive", () => {
  it("ships an executable CLI and frozen lockfile without local configuration", () => {
    const root = mkdtempSync(join(tmpdir(), "gwrk-package-test-"));
    try {
      const source = join(root, "source");
      mkdirSync(join(source, "dist"), { recursive: true });
      mkdirSync(join(source, ".gwrk"));
      mkdirSync(join(source, "deploy/linux-runner"), { recursive: true });
      copyFileSync("package.json", join(source, "package.json"));
      copyFileSync("pnpm-lock.yaml", join(source, "pnpm-lock.yaml"));
      writeFileSync(
        join(source, "dist/cli.js"),
        '#!/usr/bin/env node\nprocess.stdout.write("fixture-cli-ready\\n");\n',
        { mode: 0o644 },
      );
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
      const installed = join(root, "installed");
      mkdirSync(installed);
      execFileSync("tar", ["-xzf", archive, "-C", installed]);
      expect(
        execFileSync(join(installed, "package/dist/cli.js"), [], {
          encoding: "utf8",
        }),
      ).toBe("fixture-cli-ready\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ships both retention helpers so they run from the archive before pnpm install", async () => {
    const { LIFECYCLE_BOOTSTRAP_FILES } = await import(
      "../../src/release/lifecycle.js"
    );
    const { VERIFICATION_BOOTSTRAP_FILES } = await import(
      "../../src/release/verification-lifecycle.js"
    );
    const ts = await import("typescript");
    const root = mkdtempSync(join(tmpdir(), "gwrk-package-lifecycle-"));
    try {
      const source = join(root, "source");
      mkdirSync(join(source, "dist"), { recursive: true });
      copyFileSync("package.json", join(source, "package.json"));
      copyFileSync("pnpm-lock.yaml", join(source, "pnpm-lock.yaml"));
      writeFileSync(join(source, "dist/cli.js"), "#!/usr/bin/env node\n");
      const files = [
        ...new Set([
          ...LIFECYCLE_BOOTSTRAP_FILES,
          ...VERIFICATION_BOOTSTRAP_FILES,
        ]),
      ];
      for (const file of files) {
        if (!file.startsWith("dist/")) continue;
        const from = file.replace(/^dist\//, "src/").replace(/\.js$/, ".ts");
        const output = ts.transpileModule(readFileSync(from, "utf8"), {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
          fileName: from,
        }).outputText;
        mkdirSync(dirname(join(source, file)), { recursive: true });
        writeFileSync(join(source, file), output);
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

      // Mirror the installer and the staging driver: extract only the
      // bootstrap files, with no node_modules. Every static import must load.
      // Without a held lock descriptor each helper must refuse, not crash.
      const releaseRoot = join(root, "opt-gwrk");
      const runsRoot = join(root, "runs");
      const dataRoot = join(root, "data");
      for (const dir of [join(releaseRoot, "releases"), runsRoot, dataRoot])
        mkdirSync(dir, { recursive: true });
      const cases: [readonly string[], string, string[]][] = [
        [
          LIFECYCLE_BOOTSTRAP_FILES,
          "package/dist/release/lifecycle.js",
          [
            "install-preflight",
            "--release-root",
            releaseRoot,
            "--candidate",
            "1.6.0-beta.2",
            "--uncompressed-bytes",
            "1",
            "--service-unit",
            "none",
            "--lock-fd",
            "9",
          ],
        ],
        [
          VERIFICATION_BOOTSTRAP_FILES,
          "package/dist/release/verification-lifecycle.js",
          [
            "verification-preflight",
            "--runs-root",
            runsRoot,
            "--data-root",
            dataRoot,
            "--run-id",
            "a".repeat(24),
            "--build-bytes",
            "1",
            "--data-bytes",
            "0",
            "--lock-fd",
            "9",
          ],
        ],
      ];
      for (const [bootstrap, entry, args] of cases) {
        const extracted = join(root, `extract-${bootstrap.length}`);
        mkdirSync(extracted);
        execFileSync("tar", [
          "-xzf",
          archive,
          "-C",
          extracted,
          "--",
          ...bootstrap.map((file: string) => `package/${file}`),
        ]);
        const result = spawnSync(
          process.execPath,
          [join(extracted, entry), ...args],
          {
            encoding: "utf8",
            env: { PATH: process.env.PATH ?? "" },
          },
        );
        expect(result.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find/);
        expect(result.stderr).toMatch(/does not hold the exclusive lock/);
        expect(result.status).toBe(1);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
