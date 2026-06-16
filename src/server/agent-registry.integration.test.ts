/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadRegistry } from "./agent-registry";

describe("agent-registry integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads registry from a real .gwrkrc.json file", () => {
    const config = {
      agents: {
        registry: {
          gemini: {
            type: "local-cli",
            command: "gemini --model {{model}}",
            discoveryMethod: "manual",
            quotaProbe: {
              method: "interactive-scrape",
              command: "gemini",
              sendKeys: "/stats",
              parseRegex: "(\\d+)%",
              cacheTTLMinutes: 5,
            },
            maxConcurrent: 2,
            models: [{ name: "flash", tier: "fast", modelFlag: "flash" }],
          },
        },
        fallbackOrder: ["gemini"],
      },
    };

    fs.writeFileSync(path.join(tmpDir, ".gwrkrc.json"), JSON.stringify(config));

    const registry = loadRegistry(tmpDir);
    expect(registry.backends.gemini).toBeDefined();
    expect(registry.backends.gemini.command).toBe("gemini --model {{model}}");
    expect(registry.fallbackOrder).toEqual(["gemini"]);
  });
});
