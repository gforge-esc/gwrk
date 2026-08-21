/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * 029 Decision Records — RED tests for TR-003 (FR-001, FR-008).
 *
 * @phase 02
 * @status red
 *
 * Handler-level, per `research.test.ts`: import `adrCommandHandler`, mock the
 * engine, assert the returned string. `console.log` stays in the action so the
 * handler is unit-testable, and the action's `withSignal` wrapper is asserted
 * structurally (it sets `process.exitCode` rather than throwing, so driving the
 * action here would leak an exit code into the vitest worker).
 *
 * Phase 08 amends this file with the `--decide` cases (FR-023 command wiring):
 * the test activator is file-scoped, so two phases cannot share one file — see
 * `gap-matrix.md`. The engine half of `--decide` is covered by
 * `src/engine/adr-amend.test.ts`.
 *
 * The module under test is loaded with a dynamic `import` inside each test: a
 * top-level static import of a file that does not exist yet fails at COLLECTION,
 * which reports `Tests  no tests` and trips the ADR-005 §10.2.1 liveness check.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const scaffoldMock = vi.hoisted(() => ({
  scaffold: vi.fn(),
  renderTemplate: vi.fn(),
  findProjectRoot: vi.fn(),
  resolveDecisionsDir: vi.fn(),
  allocateNumber: vi.fn(),
}));
vi.mock("../engine/adr-scaffold.js", () => scaffoldMock);

const load = () => import("./adr.js");

const TEMPLATE = [
  "# ADR-010: Decision Records",
  "",
  "> **Status:** Proposed",
  "> **Date:** 2026-08-20",
  "> **Constraint:**",
  "",
  "## 1. Context",
  "",
  "## Amendments",
  "",
].join("\n");

describe("029 FR-001: gwrk define adr command surface (US-001)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scaffoldMock.scaffold.mockResolvedValue({
      filePath: "/repo/docs/decisions/ADR-010-decision-records.md",
      id: "ADR-010",
      number: "010",
      slug: "decision-records",
    });
    scaffoldMock.renderTemplate.mockReturnValue(TEMPLATE);
    scaffoldMock.findProjectRoot.mockResolvedValue("/repo");
    scaffoldMock.resolveDecisionsDir.mockResolvedValue("/repo/docs/decisions");
    scaffoldMock.allocateNumber.mockResolvedValue("010");
  });

  it.skip("FR-001: returns the written path for a title argument", async () => {
    const { adrCommandHandler } = await load();

    const output = await adrCommandHandler({ target: "Decision Records" });

    expect(scaffoldMock.scaffold).toHaveBeenCalledWith(
      "Decision Records",
      expect.anything(),
    );
    expect(output).toContain("ADR-010-decision-records.md");
  });

  it.skip("FR-001: --print emits the template and writes nothing", async () => {
    const { adrCommandHandler } = await load();

    const output = await adrCommandHandler({ print: true });

    // `--print` is a query: template to stdout, nothing written (contract §2).
    expect(output).toContain("# ADR-010: Decision Records");
    expect(output).toContain("> **Status:** Proposed");
    expect(output).toMatch(/^## Amendments$/m);
    expect(scaffoldMock.scaffold).not.toHaveBeenCalled();
  });

  it.skip("FR-001: rejects an empty title with the corrective command", async () => {
    const { adrCommandHandler } = await load();

    scaffoldMock.scaffold.mockRejectedValue(
      new Error('Title is required: gwrk define adr "<title>"'),
    );

    await expect(adrCommandHandler({ target: "" })).rejects.toThrow(
      /Title is required: gwrk define adr "<title>"/,
    );
  });

  it.skip("FR-001: surfaces the collision message rather than swallowing it", async () => {
    const { adrCommandHandler } = await load();

    scaffoldMock.scaffold.mockRejectedValue(
      new Error(
        "ADR-010 already exists: docs/decisions/ADR-010-something-else.md",
      ),
    );

    await expect(
      adrCommandHandler({ target: "Decision Records" }),
    ).rejects.toThrow(/ADR-010 already exists: /);
  });

  it.skip("FR-001: exports a commander Command named adr with an Examples: help block", async () => {
    const { adrCommand } = await load();

    expect(adrCommand.name()).toBe("adr");
    expect(adrCommand.helpInformation()).toMatch(/Examples:/i);
  });

  it.skip("FR-001: wraps the action in withSignal so the [exit:N | Xs] line is emitted", async () => {
    // ADR-004 agent-native output. D12 records that `define research` skips
    // this; FR-001 explicitly forbids copying that omission. Asserted on the
    // source because withSignal sets process.exitCode instead of throwing, so
    // invoking the action here would leak an exit code into the worker.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");

    const source = readFileSync(
      fileURLToPath(new URL("./adr.ts", import.meta.url)),
      "utf-8",
    );

    expect(source).toContain('withSignal("define adr"');
  });

  it.skip("FR-008: declares neither --refs nor --dry-run, and offers --print instead", async () => {
    const { adrCommand } = await load();

    const flags = adrCommand.options.map((o) => o.long ?? o.short ?? "");

    // TC-013: the nine-entry baseline in cli.option-collisions.test.ts must
    // stay nine with no allowlist entry. A flag that cannot collide cannot
    // repeat D1.
    expect(flags).not.toContain("--refs");
    expect(flags).not.toContain("--dry-run");
    // The dry-run affordance ships as `--print`, avoiding the parent's flag.
    expect(flags).toContain("--print");
  });
});
