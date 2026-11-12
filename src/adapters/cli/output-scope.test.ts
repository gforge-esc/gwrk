/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { program, runCli } from "../../cli.js";
import { writeScopedStdout } from "./output-scope.js";

const loadReadyPlan = vi.fn();

vi.mock("../../engine/plan-store.js", () => ({
  PlanStore: class {
    isEmpty() {
      return false;
    }

    getSolver() {
      return loadReadyPlan();
    }

    updatePhase() {
      throw new Error("Missing phase");
    }
  },
}));

describe("CLI invocation output", () => {
  it("keeps the process stdout writer intact after an agent command", async () => {
    const capture = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const writer = process.stdout.write;
    program.addCommand(
      new Command("output-scope-proof").action(() => {
        writeScopedStdout("\u001b[32mscope proof\u001b[0m\n");
      }),
    );

    try {
      await program.parseAsync(["--agent", "output-scope-proof"], {
        from: "user",
      });
      expect(
        capture.mock.calls.some(([chunk]) => chunk === "scope proof\n"),
      ).toBe(true);
      expect(process.stdout.write).toBe(writer);
      await program.parseAsync(["output-scope-proof"], { from: "user" });
      expect(
        capture.mock.calls.some(
          ([chunk]) => chunk === "\u001b[32mscope proof\u001b[0m\n",
        ),
      ).toBe(true);
    } finally {
      process.stdout.write = writer;
      capture.mockRestore();
    }
  });

  it("keeps agent and normal output separate during overlapping plan commands", async () => {
    const writer = process.stdout.write;
    let open: () => void = () => undefined;
    const overlap = new Promise<void>((resolve) => {
      open = resolve;
    });
    let started = 0;
    loadReadyPlan.mockImplementation(async () => {
      started += 1;
      if (started === 2) open();
      await overlap;
      return {
        getReadyQueue: () => [
          { id: "phase-01", name: "Boundary", sp_estimate: 1 },
        ],
      };
    });

    const agentOut: string[] = [];
    const normalOut: string[] = [];
    const agentErr: string[] = [];
    const normalErr: string[] = [];
    const codes = await Promise.all([
      runCli(["--agent", "plan", "next"], {
        stdout: (chunk) => agentOut.push(chunk),
        stderr: (chunk) => agentErr.push(chunk),
      }),
      runCli(["plan", "next"], {
        stdout: (chunk) => normalOut.push(chunk),
        stderr: (chunk) => normalErr.push(chunk),
      }),
    ]);

    expect(codes).toEqual([0, 0]);
    expect(started).toBe(2);
    expect(agentOut.join("")).toContain("Boundary");
    expect(agentOut.join("")).not.toContain("\u001b[");
    expect(normalOut.join("")).toContain("Boundary");
    expect(normalOut.join("")).toContain("\u001b[");
    expect(agentErr.join("")).toMatch(/\[exit:0 \| /);
    expect(normalErr.join("")).toMatch(/\[exit:0 \| /);
    expect(process.stdout.write).toBe(writer);
  });

  it("keeps JSON output and failing exit codes within their own invocations", async () => {
    const exitCode = process.exitCode;
    loadReadyPlan.mockResolvedValue({
      getReadyQueue: () => [
        { id: "phase-01", name: "Boundary", sp_estimate: 1 },
      ],
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    const codes = await Promise.all([
      runCli(["--agent", "--format", "json", "plan", "next"], {
        stdout: (chunk) => stdout.push(chunk),
        stderr: () => undefined,
      }),
      runCli(["plan", "set", "missing", "--status", "SHIPPED"], {
        stdout: () => undefined,
        stderr: (chunk) => stderr.push(chunk),
      }),
    ]);

    expect(codes).toEqual([0, 1]);
    expect(JSON.parse(stdout.join(""))).toEqual([
      { id: "phase-01", name: "Boundary", sp_estimate: 1 },
    ]);
    expect(stderr.join("")).toMatch(/\[exit:1 \| .*Missing phase/);
    expect(process.exitCode).toBe(exitCode);
  });
});
