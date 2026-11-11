/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { parseAgyModelList } from "./agy-catalog.js";
import { readCodexModelCatalog } from "./codex-catalog.js";

const fakeAppServer = `
  const readline = require("node:readline");
  const input = readline.createInterface({ input: process.stdin });
  let initialized = false;
  input.on("line", (line) => {
    const request = JSON.parse(line);
    if (request.method === "initialized") {
      initialized = true;
      return;
    }
    if (request.method === "initialize") {
      console.log(JSON.stringify({ id: request.id, result: {} }));
      return;
    }
    if (!initialized || request.method !== "model/list" || request.params.includeHidden) {
      process.exit(3);
    }
    const model = (id, hidden = false) => ({
      id: "inventory-" + id,
      model: id,
      hidden,
      isDefault: id === "gpt-6.1-sol",
      supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }],
    });
    const page = request.params.cursor === "next"
      ? { data: [model("gpt-6-astra")], nextCursor: null }
      : { data: [model("gpt-6.1-sol"), model("gpt-hidden", true)], nextCursor: "next" };
    console.log(JSON.stringify({ method: "notice", params: {} }));
    console.log(JSON.stringify({ id: request.id, result: page }));
  });
`;

describe("model discovery", () => {
  it("reads all Codex pages, ignoring notifications and excluding hidden models", async () => {
    const models = await readCodexModelCatalog(
      [process.execPath, "-e", fakeAppServer],
      2_000,
    );
    expect(models).toMatchObject([
      {
        backend: "codex",
        provider: "openai",
        family: "gpt",
        modelId: "gpt-6.1-sol",
        isDefault: true,
        supportedEfforts: ["low", "high"],
      },
      { modelId: "gpt-6-astra", isDefault: false },
    ]);
  });

  it("bounds an unresponsive Codex catalog request", async () => {
    await expect(
      readCodexModelCatalog(
        [process.execPath, "-e", "setInterval(() => {}, 1000)"],
        50,
      ),
    ).rejects.toThrow(/timed out/);
  });

  it("preserves exact Antigravity model IDs and their underlying providers", () => {
    const output = [
      "Fetching available models...",
      "gemini-4-carbon-medium\tGemini 4 Carbon (Medium)",
      "claude-opus-5-5-high\tClaude Opus 5.5 (High)",
      "gpt-oss-120b-medium\tGPT-OSS 120B (Medium)",
      "auto\tAuto",
    ].join("\n");

    expect(parseAgyModelList(output)).toMatchObject([
      {
        backend: "agy",
        modelId: "gemini-4-carbon-medium",
        provider: "google",
        family: "gemini",
      },
      {
        backend: "agy",
        modelId: "claude-opus-5-5-high",
        provider: "anthropic",
        family: "claude",
      },
      {
        backend: "agy",
        modelId: "gpt-oss-120b-medium",
        provider: "openai",
        family: "gpt",
      },
    ]);
  });
});
