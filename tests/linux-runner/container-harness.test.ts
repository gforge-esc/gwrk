/* This Source Code Form is subject to the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("keeps package workspace and cache on the harness backing volume", () => {
  const root = mkdtempSync(join(tmpdir(), "gwrk-harness-allocation-"));
  try {
    const bin = join(root, "bin");
    const data = join(root, "data");
    mkdirSync(bin);
    mkdirSync(data);
    const capture = join(root, "docker.jsonl");
    writeFileSync(join(bin, "git"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    writeFileSync(
      join(bin, "docker"),
      `#!${process.execPath}\nrequire('node:fs').appendFileSync(process.env.HARNESS_CAPTURE, JSON.stringify(process.argv.slice(2))+'\\n');\n`,
      { mode: 0o755 },
    );
    const result = spawnSync(
      process.execPath,
      ["tests/linux-runner/container-harness.mjs"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          TMPDIR: data,
          HARNESS_CAPTURE: capture,
          PATH: `${bin}:${process.env.PATH}`,
        },
        timeout: 15000,
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const [builder] = readFileSync(capture, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(builder).toContain("GWRK_RELEASE_BUILDS_ROOT=/workspace/builds");
    expect(builder).toContain("GWRK_RELEASE_CACHE=/workspace/cache");
    expect(
      builder.some(
        (arg) =>
          arg.startsWith(`type=bind,source=${data}/`) &&
          arg.endsWith(",target=/workspace"),
      ),
    ).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
