/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createQuarantine } from "./retention-quarantine.js";

let base: string;
let control: string;
let item: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "gwrk-quarantine-"));
  control = join(base, ".retention");
  item = join(base, "releases/1.0.0");
  mkdirSync(item, { recursive: true });
  writeFileSync(join(item, "payload"), "old release");
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const yes = async () => true;

describe("quarantine recovery", () => {
  it("removes an interrupted quarantine that matches its intent and identity", async () => {
    const quarantine = createQuarantine(control);
    const { token, parked } = await quarantine.park({
      key: "release:1.0.0",
      source: item,
      identity: "abc",
    });
    // Crash: the process dies before discard.
    expect(existsSync(parked)).toBe(true);
    const seen: string[] = [];
    const result = await createQuarantine(control).recover(async (intent) => {
      seen.push(intent.identity);
      return true;
    });
    expect(result.recovered).toEqual([token]);
    expect(result.preserved).toEqual([]);
    expect(seen).toEqual(["abc"]);
    expect(existsSync(parked)).toBe(false);
    expect(readdirSync(join(control, "intents"))).toEqual([]);
  });

  it("preserves an entry with no intent", async () => {
    mkdirSync(join(control, "trash/stranger"), { recursive: true });
    writeFileSync(join(control, "trash/stranger/sentinel"), "keep");
    const result = await createQuarantine(control).recover(yes);
    expect(result.recovered).toEqual([]);
    expect(result.preserved).toEqual([
      { name: "stranger", reason: "no quarantine intent" },
    ]);
    expect(readFileSync(join(control, "trash/stranger/sentinel"), "utf8")).toBe(
      "keep",
    );
  });

  it("preserves a different directory placed under an intent's name", async () => {
    const quarantine = createQuarantine(control);
    const { parked } = await quarantine.park({
      key: "release:1.0.0",
      source: item,
      identity: "abc",
    });
    renameSync(parked, join(base, "moved-away"));
    mkdirSync(parked);
    writeFileSync(join(parked, "sentinel"), "foreign");
    const result = await createQuarantine(control).recover(yes);
    expect(result.recovered).toEqual([]);
    expect(result.preserved[0]?.reason).toMatch(/identity/);
    expect(readFileSync(join(parked, "sentinel"), "utf8")).toBe("foreign");
  });

  it("preserves an entry when the owner rejects its identity", async () => {
    const { parked } = await createQuarantine(control).park({
      key: "release:1.0.0",
      source: item,
      identity: "abc",
    });
    const result = await createQuarantine(control).recover(async () => false);
    expect(result.recovered).toEqual([]);
    expect(existsSync(parked)).toBe(true);
  });

  it("never follows a symlink planted in the quarantine directory", async () => {
    const outside = join(base, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "gwrk.db"), "ledger");
    mkdirSync(join(control, "trash"), { recursive: true });
    symlinkSync(outside, join(control, "trash/link"));
    const result = await createQuarantine(control).recover(yes);
    expect(result.preserved.map((p) => p.name)).toEqual(["link"]);
    expect(readFileSync(join(outside, "gwrk.db"), "utf8")).toBe("ledger");
  });

  it("clears an intent whose item never moved and leaves the item in place", async () => {
    const quarantine = createQuarantine(control, {
      beforeRename: () => {
        throw new Error("crash before rename");
      },
    });
    await expect(
      quarantine.park({ key: "release:1.0.0", source: item, identity: "abc" }),
    ).rejects.toThrow(/crash/);
    const result = await createQuarantine(control).recover(yes);
    expect(result.recovered).toEqual([]);
    expect(readFileSync(join(item, "payload"), "utf8")).toBe("old release");
    expect(readdirSync(join(control, "intents"))).toEqual([]);
  });

  it("discards a completed quarantine without leaving an intent", async () => {
    const quarantine = createQuarantine(control);
    const { token, parked } = await quarantine.park({
      key: "release:1.0.0",
      source: item,
      identity: "abc",
    });
    await quarantine.discard(token);
    expect(existsSync(parked)).toBe(false);
    expect(readdirSync(join(control, "intents"))).toEqual([]);
  });
});
