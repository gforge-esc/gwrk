/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

it.each(["README.md", "docs/site/getting-started.md"])(
  "%s stops the documented install before extraction when checksum verification fails",
  (file) => {
    const text = readFileSync(path.resolve(file), "utf8");
    const block = [...text.matchAll(/```bash\n([\s\S]*?)```/g)]
      .map((match) => match[1])
      .find((candidate) => candidate.includes("shasum -a 256 -c"));
    expect(block).toBeDefined();
    const root = mkdtempSync(path.join(tmpdir(), "gwrk-doc-checksum-"));
    try {
      const bin = path.join(root, "bin");
      const home = path.join(root, "home");
      const marker = path.join(root, "tar-called");
      mkdirSync(bin);
      mkdirSync(home);
      for (const [command, body] of Object.entries({
        curl: "exit 0",
        shasum: "exit 1",
        tar: 'printf extracted > "$GWRK_AUDIT_MARKER"',
        pnpm: "exit 0",
        chmod: "exit 0",
        ln: "exit 0",
      })) {
        writeFileSync(path.join(bin, command), `#!/bin/sh\n${body}\n`, {
          mode: 0o755,
        });
      }
      const result = spawnSync("/bin/bash", ["-c", block ?? ""], {
        cwd: root,
        env: {
          ...process.env,
          HOME: home,
          PATH: `${bin}:/usr/bin:/bin`,
          GWRK_AUDIT_MARKER: marker,
        },
        encoding: "utf8",
        timeout: 10_000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
