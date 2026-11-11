/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { program } from "../../cli.js";

describe("CLI invocation output", () => {
  it("keeps the process stdout writer intact after an agent command", async () => {
    const capture = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const writer = process.stdout.write;
    program.addCommand(
      new Command("output-scope-proof").action(() => {
        process.stdout.write("\u001b[32mscope proof\u001b[0m\n");
      }),
    );

    try {
      await program.parseAsync(["--agent", "output-scope-proof"], {
        from: "user",
      });
      expect(capture.mock.calls.some(([chunk]) => chunk === "scope proof\n")).toBe(true);
      expect(process.stdout.write).toBe(writer);
    } finally {
      process.stdout.write = writer;
      capture.mockRestore();
    }
  });
});
