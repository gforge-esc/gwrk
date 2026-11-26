/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VERIFICATION_BOOTSTRAP_FILES, main } from "./verification-lifecycle.js";

describe("verification-preflight bootstrap", () => {
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
    visit("src/release/verification-lifecycle.ts");
    const expected = [...seen]
      .map((source) => source.replace(/^src\//, "dist/").replace(/\.ts$/, ".js"))
      .sort();
    expect(
      VERIFICATION_BOOTSTRAP_FILES.filter((file) => file.startsWith("dist/")).sort(),
    ).toEqual(expected);
  });
});

describe("verification-preflight entry point", () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "gwrk-verification-entry-"));
    mkdirSync(join(base, "runs"));
    mkdirSync(join(base, "data"));
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  const argv = (extra: string[] = [], buildBytes = String(2 ** 52)) => [
    "verification-preflight",
    "--runs-root",
    join(base, "runs"),
    "--data-root",
    join(base, "data"),
    "--run-id",
    "a".repeat(24),
    "--build-bytes",
    buildBytes,
    "--data-bytes",
    "0",
    "--root-path",
    base,
    "--lock-fd",
    "9",
    ...extra,
  ];
  const held = () => ({ assertHeld: async () => {} });

  it("fails before staging when the build cannot fit", async () => {
    const errors: string[] = [];
    const code = await main(argv(), {
      docker: async (args) =>
        args[0] === "ps" ? { code: 0, stdout: "" } : { code: 1, stdout: "" },
      leaseBusy: async () => false,
      lockProof: held,
      out: () => {},
      err: (t) => errors.push(t),
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/root floor \+ build workspace/);
  });

  it("deletes nothing and fails when the retention lock cannot be proven", async () => {
    const errors: string[] = [];
    const code = await main(argv([], "1"), {
      docker: async () => ({ code: 0, stdout: "" }),
      leaseBusy: async () => false,
      lockProof: () => ({
        assertHeld: async () => {
          throw new Error("Retention lock is not held by this process.");
        },
      }),
      out: () => {},
      err: (t) => errors.push(t),
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/lock/);
  });

  it("proves the lock against the runs root lock file", async () => {
    const seen: [number, string][] = [];
    await main(argv([], "1"), {
      docker: async () => ({ code: 0, stdout: "" }),
      leaseBusy: async () => false,
      lockProof: (fd, path) => {
        seen.push([fd, path]);
        return held();
      },
      out: () => {},
      err: () => {},
    });
    expect(seen).toEqual([
      [9, join(realpathSync(base), "runs", ".retention.lock")],
    ]);
  });

  it.each([
    [["--protected-images", "/tmp/protected.json"]],
    [["--force", "1"]],
  ])("rejects removed or unknown flags %j", async (extra) => {
    expect(await main(argv(extra), { out: () => {}, err: () => {} })).toBe(2);
  });

  it("requires a lock descriptor", async () => {
    const args = argv().slice(0, -2);
    expect(await main(args, { out: () => {}, err: () => {} })).toBe(2);
  });
});
