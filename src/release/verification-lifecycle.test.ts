/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "./verification-lifecycle.js";

const wrapper = readFileSync("deploy/verification/stage-preflight.sh", "utf8");

describe("stage-preflight.sh", () => {
  it("holds the lease, runs preflight under the retention lock, then execs staging", () => {
    const lease = wrapper.indexOf("flock -xn 7");
    const lock = wrapper.indexOf("flock -x 8");
    const preflight = wrapper.indexOf("verification-preflight");
    const release = wrapper.indexOf("exec 8>&-");
    const staging = wrapper.indexOf('exec "$@"');
    expect(lease).toBeGreaterThan(0);
    expect(lease).toBeLessThan(lock);
    expect(lock).toBeLessThan(preflight);
    expect(preflight).toBeLessThan(release);
    expect(release).toBeLessThan(staging);
    expect(wrapper).toMatch(/Staging did not start/);
    expect(wrapper).not.toMatch(/docker (system|image) prune/);
  });
});

describe("verification-preflight entry point", () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "gwrk-verification-entry-"));
    mkdirSync(join(base, "runs"));
    mkdirSync(join(base, "data"));
    writeFileSync(join(base, "protected.json"), "[]");
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  const argv = (extra: string[] = []) => [
    "verification-preflight",
    "--runs-root",
    join(base, "runs"),
    "--data-root",
    join(base, "data"),
    "--run-id",
    "a".repeat(24),
    "--protected-images",
    join(base, "protected.json"),
    "--build-bytes",
    String(2 ** 52),
    "--data-bytes",
    "0",
    "--root-path",
    base,
    ...extra,
  ];

  it("fails before staging when the build cannot fit", async () => {
    const errors: string[] = [];
    const code = await main(argv(), {
      docker: async () => ({ code: 1, stdout: "" }),
      leaseBusy: async () => false,
      out: () => {},
      err: (t) => errors.push(t),
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/root floor \+ build workspace/);
  });

  it("rejects unknown flags", async () => {
    expect(
      await main(argv(["--force", "1"]), { out: () => {}, err: () => {} }),
    ).toBe(2);
  });
});
