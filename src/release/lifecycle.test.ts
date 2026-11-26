/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LIFECYCLE_BOOTSTRAP_FILES, main } from "./lifecycle.js";

const installer = readFileSync(
  "deploy/linux-runner/install-release.sh",
  "utf8",
);

describe("install-release.sh lifecycle hook", () => {
  it("runs preflight from the verified archive before extraction, install and activation", () => {
    const checksum = installer.indexOf("Release archive checksum mismatch");
    const paths = installer.indexOf(
      "Release archive contains an unexpected path",
    );
    const hook = installer.indexOf(
      'dist/release/lifecycle.js" install-preflight',
    );
    const extract = installer.indexOf("--strip-components=1");
    const pnpm = installer.indexOf("pnpm install --prod");
    const activate = installer.indexOf('mv -Tf -- "$staging/current"');
    expect(hook).toBeGreaterThan(checksum);
    expect(hook).toBeGreaterThan(paths);
    expect(hook).toBeLessThan(extract);
    expect(hook).toBeLessThan(pnpm);
    expect(hook).toBeLessThan(activate);
    expect(installer.indexOf("flock -x 9")).toBeLessThan(hook);
  });

  it("extracts exactly the bootstrap files and fails when one is missing", () => {
    for (const file of LIFECYCLE_BOOTSTRAP_FILES) {
      expect(installer).toContain(`package/${file}`);
    }
    expect(installer).toMatch(/retention helper/);
    expect(installer).not.toMatch(/lifecycle\.js"[^\n]*\|\|\s*true/);
  });

  it("lists every relative import closure and uses only the Node standard library", () => {
    const seen = new Set<string>();
    const visit = (source: string) => {
      if (seen.has(source)) return;
      seen.add(source);
      const text = readFileSync(source, "utf8");
      for (const [, specifier] of text.matchAll(/from\s+"([^"]+)"/g)) {
        if (!specifier) continue;
        if (specifier.startsWith(".")) {
          visit(
            normalize(join(dirname(source), specifier.replace(/\.js$/, ".ts"))),
          );
        } else {
          expect(specifier, `${source} imports ${specifier}`).toMatch(/^node:/);
        }
      }
    };
    visit("src/release/lifecycle.ts");
    const expected = [...seen]
      .map((source) =>
        source.replace(/^src\//, "dist/").replace(/\.ts$/, ".js"),
      )
      .sort();
    expect(
      LIFECYCLE_BOOTSTRAP_FILES.filter((file) =>
        file.startsWith("dist/"),
      ).sort(),
    ).toEqual(expected);
  });
});

describe("lifecycle entry point", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "gwrk-lifecycle-"));
    mkdirSync(join(root, "releases"));
    for (const [version, month] of [
      ["1.0.0", "01"],
      ["1.1.0", "02"],
      ["1.2.0", "03"],
      ["1.3.0", "04"],
    ]) {
      const dir = join(root, "releases", version);
      mkdirSync(dir);
      writeFileSync(
        join(dir, "release-manifest.json"),
        JSON.stringify({
          version,
          builtAt: `2026-${month}-01T00:00:00Z`,
          tarballSha256: "b".repeat(64),
        }),
      );
    }
    symlinkSync("releases/1.0.0", join(root, "current"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("applies retention on the real filesystem and writes a receipt", async () => {
    const lines: string[] = [];
    const code = await main(
      [
        "install-preflight",
        "--release-root",
        root,
        "--candidate",
        "1.4.0",
        "--uncompressed-bytes",
        "1",
      ],
      { out: (t) => lines.push(t), err: (t) => lines.push(t) },
    );
    expect(code).toBe(0);
    expect(readdirSync(join(root, "releases")).sort()).toEqual([
      "1.0.0",
      "1.2.0",
      "1.3.0",
    ]);
    expect(readdirSync(join(root, ".retention/receipts"))).toHaveLength(1);
    expect(lines.join("\n")).toMatch(/deleted=1/);
  });

  it("fails with exit 1 when the filesystem cannot hold the install", async () => {
    const errors: string[] = [];
    const code = await main(
      [
        "install-preflight",
        "--release-root",
        root,
        "--candidate",
        "1.4.0",
        "--uncompressed-bytes",
        String(2 ** 50),
      ],
      { out: () => {}, err: (t) => errors.push(t) },
    );
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/Not enough free space/);
  });

  it.each([
    [["install-preflight"]],
    [["prune", "--release-root", "/"]],
    [
      [
        "install-preflight",
        "--release-root",
        "/x",
        "--candidate",
        "../x",
        "--uncompressed-bytes",
        "1",
      ],
    ],
    [
      [
        "install-preflight",
        "--release-root",
        "/x",
        "--candidate",
        "1.0.0",
        "--uncompressed-bytes",
        "1",
        "--force",
        "1",
      ],
    ],
  ])("rejects unsafe or unknown arguments %j", async (argv) => {
    expect(await main(argv, { out: () => {}, err: () => {} })).toBe(2);
  });
});
