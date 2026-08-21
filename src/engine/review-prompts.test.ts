/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * 028-review-finding-liveness — Phase 01, TR-003 (FR-003, FR-004, TC-007).
 *
 * The prompt contract that W1 (`a57a68f`) landed, made executable.
 *
 * D1 and D9 were *prompt* defects, not wiring defects: the code-review prompt
 * told the agent to force every task in the phase to `completed` whenever gates
 * passed, under a "Gates are truth, tasks.json status is bookkeeping" callout,
 * with a "gates passed → Skip to Step 6" bypass that routed past the only
 * re-opening step. `tasks.json` is the agent's only surviving channel
 * (`revertSourceMutations()` discards everything else), so those three lines
 * destroyed the verdict channel and four blocking findings were reported as GO
 * across runs #2727 / #2728.
 *
 * Nothing in the type system or the build protects prompt prose. The `## Done
 * When` greps in specs/028's plan protect two literals; this file protects the
 * whole contract, on both prompts, so a future "simplification" cannot quietly
 * re-author the defect the way D10 shipped.
 *
 * Three rules govern how the assertions are written:
 *
 * 1. **Executable forms are asserted against fenced code only.** Prose must be
 *    free to quote a forbidden construction in order to forbid it — the
 *    bare-number CAUTION and the anti-patterns both do. A whole-file grep for
 *    `.tasks[].status = "completed"` cannot tell the anti-pattern that bans it
 *    from the jq line that performs it.
 * 2. **Prose is asserted against flattened text.** The prompts are hard-wrapped
 *    at ~100 columns and quoted with `>`, so a sentence-level assertion on the
 *    raw file matches by accident of line breaks.
 * 3. **Negatives are asserted against the whole prompt.** A banned doctrine is
 *    banned wherever it appears. Scoping a negative to the section it was
 *    deleted from leaves the same sentence free to reappear in
 *    `<verdict_criteria>`, where the agent reads it with MORE authority.
 *
 * The suite lives in `src/engine/` rather than beside the prompts: `postbuild`
 * copies `src/plugins/builtins/` into `dist/` verbatim, and `files: ["dist/"]`
 * publishes it, so a test file under that tree ships to users inside the tree
 * `PluginLoader.listPlugins` scans.
 *
 * See docs/code-review-verdict-defect.md and specs/028-review-finding-liveness/.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");

/**
 * Both roots, because both are live (TC-005). `PluginLoader` builds its
 * built-in base from `import.meta.dirname` (src/plugins/loader.ts:274), which
 * for the compiled entry point is `dist/plugins/builtins` — the copy every real
 * `gwrk ship` review dispatches. `npm run postbuild` refreshes it from `src/`,
 * so the two are equal after a build and can diverge without one: restore a
 * pre-`a57a68f` `dist/.../PROMPT.md` and the D1 force-complete is live again
 * while a `src/`-only contract stays green. Assert the artifact that runs.
 */
const ROOTS = ["src", "dist"] as const;
const PLUGINS = ["review-code-cli", "review-code-webapp"] as const;

const promptPath = (root: string, plugin: string): string =>
  path.join(
    REPO_ROOT,
    root,
    "plugins",
    "builtins",
    "reviews",
    plugin,
    "PROMPT.md",
  );

const PROMPTS = ROOTS.flatMap((root) =>
  PLUGINS.map((plugin) => ({
    name: `${root}/${plugin}`,
    file: promptPath(root, plugin),
  })),
);

/** `dist/` is a build output — say so instead of failing with a bare ENOENT. */
function readPrompt(file: string): string {
  if (!fs.existsSync(file)) {
    throw new Error(
      `${path.relative(REPO_ROOT, file)} is missing — run \`npm run build\`. ` +
        "postbuild copies src/plugins/builtins into dist/, and the runtime " +
        "dispatches the dist copy, so this contract covers both.",
    );
  }
  return fs.readFileSync(file, "utf-8");
}

/** Strip `>` blockquote markers and collapse hard wraps. Formatting, not content. */
const flatten = (s: string): string =>
  s
    .replace(/^[ \t]*>[ \t]?/gm, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Only fenced blocks are executable. Prose may quote a forbidden jq form in
 * order to ban it, and the anti-patterns section does exactly that.
 */
const fencedCode = (s: string): string =>
  [...s.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");

function tagBlock(src: string, tag: string): string {
  const m = src.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!m) throw new Error(`<${tag}> block is missing from the prompt`);
  return m[1];
}

function mdSection(src: string, heading: string): string {
  const start = src.indexOf(heading);
  if (start === -1)
    throw new Error(`section is missing from the prompt: ${heading}`);
  const rest = src.slice(start + heading.length);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

/** The lines a jq status write occupies — `==` comparisons are not writes. */
const statusWrites = (code: string): string[] =>
  code.split("\n").filter((l) => /\.status\s*=\s*"(?:completed|open)"/.test(l));

for (const { name, file } of PROMPTS) {
  const PROMPT = readPrompt(file);
  const FLAT = flatten(PROMPT);
  const CODE = fencedCode(PROMPT);

  describe(`FR-003(a) — ${name} opens with the MUST-flip-status contract`, () => {
    const scope = tagBlock(PROMPT, "scope_constraints");
    const firstBullet = flatten(scope.trim().split(/\n(?=- )/)[0]);

    it("makes the status flip the first thing the agent reads", () => {
      // Ordering is the whole lesson of D10: the sentence that disabled code
      // review was appended last, so it was read last. The contract must be
      // first, not buried mid-list.
      expect(firstBullet).toMatch(/MUST set that task's `status` to `"open"`/);
    });

    it("explains why a note alone is invisible to the orchestrator", () => {
      expect(firstBullet).toMatch(
        /A note alone is invisible to the orchestrator/,
      );
      expect(firstBullet).toMatch(
        /derives the console verdict from gate results and from tasks you moved `completed` → `open`/,
      );
      expect(firstBullet).toMatch(/finding is discarded/);
    });

    it("does not carry the D10 sentence that disabled the channel", () => {
      // NEGATIVE: the exact text, unqualified by phase, that read as
      // "never re-open anything, just write a note".
      expect(FLAT).not.toMatch(
        /note them in your summary but do NOT change its status/,
      );
    });

    it("still forbids touching tasks from other phases", () => {
      // The infinite-loop guard the D10 sentence was protecting (FR-002).
      expect(FLAT).toMatch(/Do NOT touch tasks from other phases/);
    });
  });

  describe(`FR-003(b) — ${name} states one-way gate authority`, () => {
    it("carries the §4.0 rule", () => {
      expect(PROMPT).toMatch(/\*\*Gate authority is one-way\.\*\*/);
      expect(FLAT).toMatch(
        /may close a task you raised \*\*no\*\* finding against/,
      );
      expect(FLAT).toMatch(/NEVER close a task where you reproduced a defect/);
      expect(FLAT).toMatch(/the GATE has a coverage hole/);
    });

    it("no longer asserts the broad doctrine that seeded D1", () => {
      // NEGATIVE: verbatim from a57a68f^ line 61. This callout is what the
      // phase-wide force-complete was the mechanical expression of.
      expect(FLAT).not.toMatch(
        /Gates are truth, tasks\.json status is bookkeeping/,
      );
      // The step's own title changed with it: gates are a baseline, not the verdict.
      expect(PROMPT).not.toMatch(/Verification Gates — PRIMARY VERDICT/);
      expect(PROMPT).toMatch(/Verification Gates — MECHANICAL BASELINE/);
    });
  });

  describe(`FR-003(c) — ${name} has no phase-wide force-complete`, () => {
    it("contains no phase-wide status write in executable code", () => {
      // NEGATIVE, D1 verbatim (a57a68f^ line 79):
      //   '(.phases[] | select(.id == $pid) | .tasks[].status) = "completed"'
      expect(CODE).not.toMatch(/\.tasks\[\]\.status/);
      expect(PROMPT).not.toContain('tasks[].status) = "completed"');
    });

    it("writes status one task id at a time", () => {
      const writes = statusWrites(CODE);
      expect(writes.length).toBeGreaterThan(0);
      for (const line of writes) {
        expect(line).toMatch(/select\(\.id == \$t\)/);
      }
    });

    it("writes nothing in the gate step", () => {
      expect(FLAT).toMatch(/Do NOT write any status yet/);
      expect(FLAT).toMatch(
        /Do NOT force every task in the phase to `completed` here/,
      );
    });
  });

  describe(`FR-003(d) — ${name} has no bypass past the write step`, () => {
    it("does not route past the only re-opening step when gates pass", () => {
      // NEGATIVE, D1 verbatim (a57a68f^ line 109): "If gates passed in Step 2,
      // tasks are already completed. Skip to Step 6." A finding recorded in the
      // review/test steps must reach the write step.
      expect(FLAT).not.toMatch(/Skip to Step \d/i);
      expect(FLAT).not.toMatch(/tasks are already completed/);
    });

    it("carries every task into the review steps regardless of gate result", () => {
      expect(FLAT).toMatch(/Do NOT skip a task because its gate passed/);
    });
  });

  describe(`FR-003(e) — ${name} decides each task from a table where findings win`, () => {
    it("ranks a blocking finding above a green gate", () => {
      expect(FLAT).toMatch(/Findings win over gates, always/);
      expect(PROMPT).toMatch(/\| passes \| \*\*yes\*\* \| `status: "open"`/);
      expect(PROMPT).toMatch(/\| passes \| no \| `status: "completed"`/);
    });

    it("names the gateless case, where review is the only verdict", () => {
      expect(FLAT).toMatch(
        /none \(no `gateScript`\) \| \*\*yes\*\* \| `status: "open"`/,
      );
      expect(FLAT).toMatch(/your review is the only verdict/);
    });

    it("completes tasks one at a time, never phase-wide", () => {
      expect(FLAT).toMatch(/one task at a time, by id/);
      expect(FLAT).toMatch(/Never with a phase-wide selector/);
    });
  });

  describe(`FR-003(f) — ${name} marks description writes APPEND ONLY`, () => {
    it("says APPEND ONLY and why", () => {
      expect(PROMPT).toMatch(/APPEND ONLY/);
      expect(FLAT).toMatch(/Never overwrite a description/);
      // The reason sits in a wrapped `#` bash comment, so the continuation
      // line's comment marker survives flattening — allow for it.
      expect(FLAT).toMatch(
        /may carry findings from a[\s#]*previous review or UAT pass that are not yet fixed/,
      );
    });

    it("uses `+=` for every description write in executable code", () => {
      const descWrites = CODE.split("\n").filter((l) =>
        /\.description\s*\+?=/.test(l),
      );
      expect(descWrites.length).toBeGreaterThan(0);
      for (const line of descWrites) {
        expect(line).toMatch(/\.description \+=/);
      }
    });
  });

  describe(`FR-003(g) — ${name} states where the verdict really comes from`, () => {
    const verdict = flatten(tagBlock(PROMPT, "verdict_criteria"));
    const json = flatten(mdSection(PROMPT, "## JSON Intent Format"));

    it("derives the console verdict from gates plus re-opens", () => {
      expect(verdict).toMatch(
        /derives the console verdict from two things only: the gate results it runs itself, and the tasks it sees you move `completed` → `open`/,
      );
      expect(verdict).toMatch(
        /a NO-GO you did not write into `tasks\.json` is not a NO-GO/,
      );
    });

    it("warns that the returned JSON is a log summary, not the verdict channel", () => {
      expect(json).toMatch(
        /summary for the human reading the log, not the verdict channel/,
      );
      expect(json).toMatch(/never parses this object/);
    });

    it("warns that returned intents are reverted", () => {
      expect(json).toMatch(/`intents` will not be applied/);
      expect(json).toMatch(
        /`tasks\.json` is the only write of yours that survives/,
      );
    });
  });

  describe(`FR-003(h) — ${name} carries the inverted anti-patterns`, () => {
    const anti = flatten(mdSection(PROMPT, "## Anti-Patterns"));

    it("bans leaving a task completed after a blocking finding", () => {
      expect(anti).toMatch(
        /Leaving a task `completed` after recording a blocking finding against it/,
      );
      expect(anti).toMatch(/A green gate is not permission to close a finding/);
    });

    it("bans writing status before the write step", () => {
      expect(anti).toMatch(/Writing `status` before Step 8/);
    });

    it("bans bare-number phase selectors and description overwrites", () => {
      expect(anti).toMatch(/Selecting phases by bare number/);
      expect(anti).toMatch(/Overwriting a task `description`/);
    });

    it("no longer names task status as the wrong verdict channel, anywhere", () => {
      // NEGATIVE, D9 verbatim (a57a68f^): "❌ Using tasks.json status as primary
      // verdict when gates exist (gates are truth)" — the anti-pattern that told
      // the agent its only real channel was a mistake to use.
      //
      // Asserted against FLAT, not `anti`: scoped to `## Anti-Patterns`, the
      // same sentence could reappear in <verdict_criteria> or
      // <closed_loop_contract> — where the agent reads it as doctrine rather
      // than as one bullet in a list — with all cases still green.
      expect(FLAT).not.toMatch(/Using tasks\.json status as primary verdict/);
      expect(FLAT).not.toMatch(/gates are truth/i);
    });
  });

  describe(`FR-004 — ${name} selects phases by $PHASE_ID only`, () => {
    it("defines PHASE_ID as the zero-padded id", () => {
      expect(FLAT).toMatch(/PHASE_ID="phase-\{phase_number\}"/);
      expect(FLAT).toMatch(/zero-padded/);
    });

    it("pairs every executable .phases[] selector with $pid", () => {
      const selectors = CODE.split("\n").filter((l) => l.includes(".phases[]"));
      expect(selectors.length).toBeGreaterThan(0);
      for (const line of selectors) {
        expect(line).toMatch(/select\(\.id == \$pid\)/);
      }
    });

    it("never selects a phase by bare number in executable code", () => {
      // NEGATIVE: `select(.id == "5")` matches nothing, jq rewrites the file
      // unchanged, and the re-open vanishes with a zero exit code.
      expect(CODE).not.toMatch(/select\(\.id\s*==\s*"?\d/);
    });

    it("cautions that a bare-number selector fails silently", () => {
      expect(FLAT).toMatch(/never the bare phase number/);
      expect(FLAT).toMatch(
        /matches nothing and the jq silently rewrites the file unchanged/,
      );
    });

    it("ends the write step with a read-back verification", () => {
      expect(CODE).toContain('.id + " " + .status');
      expect(PROMPT.indexOf('.id + " " + .status')).toBeGreaterThan(
        PROMPT.indexOf('.status = "completed"'),
      );
      expect(FLAT).toMatch(
        /Every task you raised a blocking finding against MUST appear as `open`/,
      );
    });
  });
}

describe("TC-007 — the two code-review prompts stay byte-identical", () => {
  it("is a byte-for-byte match in src/", () => {
    const [cli, webapp] = PLUGINS.map((p) =>
      fs.readFileSync(promptPath("src", p)),
    );
    expect(webapp.equals(cli)).toBe(true);
  });

  it("is a byte-for-byte match in dist/", () => {
    const [cli, webapp] = PLUGINS.map((p) =>
      fs.readFileSync(promptPath("dist", p)),
    );
    expect(webapp.equals(cli)).toBe(true);
  });
});

describe("TC-005 — the dispatched prompt is the one under contract", () => {
  // The contract above runs over both roots, so a stale `dist/` fails it on
  // content. This pins the cheaper, blunter property too: after a build the
  // dispatched bytes ARE the reviewed bytes. A drift here means `postbuild`
  // stopped copying, which no content assertion would name.
  for (const plugin of PLUGINS) {
    it(`dist/${plugin}/PROMPT.md matches src/`, () => {
      const src = fs.readFileSync(promptPath("src", plugin));
      const dist = fs.readFileSync(promptPath("dist", plugin));
      expect(dist.equals(src)).toBe(true);
    });
  }

  it("publishes no test source inside the copied reviews tree", () => {
    // `postbuild` copies src/plugins/builtins/* into dist/ verbatim and
    // `files: ["dist/"]` publishes it, so a `.test.ts` beside a PROMPT.md ships
    // to users — uncompiled, importing `vitest`, inside the tree
    // `PluginLoader.listPlugins` scans. This suite used to live there.
    // (Sibling built-in trees leak test sources the same way; that predates
    // this feature and is not this phase's to fix.)
    const distReviews = path.join(
      REPO_ROOT,
      "dist",
      "plugins",
      "builtins",
      "reviews",
    );
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? walk(p) : [p];
      });
    const shipped = walk(distReviews)
      .filter((f) => f.endsWith(".test.ts"))
      .map((f) => path.relative(REPO_ROOT, f));
    expect(shipped).toEqual([]);

    // And the source it would be copied from is gone for good.
    expect(
      fs.existsSync(
        path.join(
          REPO_ROOT,
          "src",
          "plugins",
          "builtins",
          "reviews",
          "review-prompts.test.ts",
        ),
      ),
    ).toBe(false);
  });
});
