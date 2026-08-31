/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../utils/config.js";

/**
 * 029 Decision Records — the ADR author (FR-002, FR-003, FR-019).
 *
 * Contract: `specs/029-decision-records/contracts/adr-engine.md` §3.
 *
 * Same shape as `research-scaffold.ts:66-75` with its three flaws corrected:
 * the corpus filter runs on the `.md` suffix AND the record pattern rather than
 * a raw readdir; a taken number fails loudly naming the conflicting path rather
 * than silently writing a sibling; and the project root is discovered by walking
 * parents for `.gwrkrc.json`, as `init.ts` does, rather than joining
 * `process.cwd()` with literals — which is what makes the command work from any
 * subdirectory.
 *
 * TC-015 keeps a lock manager out of a human-paced command, and the number claim
 * is still atomic. Check-then-write cannot serialise two writers: both re-read
 * before either writes, so both see a free number, and `wx` on the record only
 * refuses an identical filename — a second slug at the same number sails past
 * it. The claim is therefore `.ADR-NNN.claim`, published by an atomic `link` the
 * kernel grants to exactly one writer and released on the way out. No daemon, no
 * timeout, no retry loop.
 *
 * That claim is a documented departure from TC-015's original no-lockfile
 * wording, recorded as AMBER-3 in `plan.md` > Resolved Ambiguities and carried
 * into FR-002, TC-015 and the engine contract.
 *
 * Bare-clone operable (TC-014): no SQLite, no build server, no network.
 */

export interface AdrScaffoldResult {
  /** Absolute path written. */
  filePath: string;
  /** Canonical id, e.g. `ADR-` plus the allocated number. */
  id: string;
  /** Zero-padded three-digit number. */
  number: string;
  /** Slugified title, as it appears in the filename. */
  slug: string;
}

export interface AdrTemplateInput {
  number: string;
  title: string;
  /** ISO date, stamped by the caller so the template is a pure function. */
  date: string;
}

export interface AdrScaffoldOptions {
  /** Where the root walk starts. Defaults to the process working directory. */
  cwd?: string;
}

/** The marker `init.ts:26-30` walks for. One project root, one definition. */
const PROJECT_MARKER = ".gwrkrc.json";

/** Where records live when `project.architecture.decisions` says nothing. */
const DEFAULT_DECISIONS_DIR = path.join("docs", "decisions");

/**
 * The one `loadConfig` failure that is not a TC-002 fail-fast condition. Matched
 * on the message `utils/config.ts` throws when `.gwrkrc.json` is absent.
 */
const CONFIG_ABSENT = /Configuration file \.gwrkrc\.json not found/;

/**
 * The `.md` suffix AND the record pattern (FR-002). A raw readdir is the first
 * flaw of the research allocator: a stray `notes.txt`, a `README.md` or a
 * directory would all skew the allocation.
 */
const RECORD_FILE = /^ADR-(\d{3})-.*\.md$/;

/**
 * The claim token for one number. Dot-prefixed and not `.md`, so it is invisible
 * to every `docs/decisions/*.md` reader — the parser, the index and the ontology
 * scanner all keep seeing a directory of records only.
 */
const CLAIM_FILE = /^\.ADR-(\d{3})\.claim$/;

/** One directory entry that is a record, with its number already extracted. */
interface RecordEntry {
  name: string;
  number: string;
}

/** The two kinds of entry that occupy a number. */
interface Corpus {
  records: RecordEntry[];
  /** Numbers held by an in-flight claim, or by one a crashed run left behind. */
  claimed: Set<string>;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function errnoOf(error: unknown): string {
  const code = isErrnoException(error) ? error.code : undefined;
  return code ?? (error instanceof Error ? error.message : `${error}`);
}

function claimPathFor(decisionsDir: string, number: string): string {
  return path.join(decisionsDir, `.ADR-${number}.claim`);
}

/** Distinguishes two staged claims inside one process. */
let stageSeq = 0;

/**
 * Claims the number, or throws `EEXIST` if another run holds it.
 *
 * Staged then linked, rather than created then written, because the claim has to
 * carry the winner's filename from the instant it is visible. An exclusive
 * `open` followed by a write leaves a window in which a loser sees the claim and
 * reads it empty, and two runs racing hit that window often. `link` publishes a
 * file that is already complete, and refuses when the target exists — one
 * atomic step, no window.
 */
async function claimNumber(
  decisionsDir: string,
  number: string,
  fileName: string,
): Promise<void> {
  const stagePath = path.join(
    decisionsDir,
    `.ADR-${number}.${process.pid}-${++stageSeq}.stage`,
  );

  const stage = await fs.open(stagePath, "w");
  try {
    await stage.writeFile(fileName, "utf-8");
  } finally {
    await stage.close();
  }

  try {
    await fs.link(stagePath, claimPathFor(decisionsDir, number));
  } finally {
    await fs.unlink(stagePath).catch(() => {});
  }
}

/** Reads the corpus, keeping only the entries FR-002 counts as records. */
async function readCorpus(decisionsDir: string): Promise<Corpus> {
  let entries: string[];
  try {
    entries = await fs.readdir(decisionsDir);
  } catch (error: unknown) {
    // A project that has never recorded a decision is not an error state: the
    // first `gwrk define adr` creates the directory on its way to writing 001.
    if (isErrnoException(error) && error.code === "ENOENT") {
      return { records: [], claimed: new Set() };
    }
    throw error;
  }

  const records: RecordEntry[] = [];
  const claimed = new Set<string>();
  for (const entry of entries) {
    const name = String(entry);
    const record = RECORD_FILE.exec(name);
    if (record) {
      records.push({ name, number: record[1] });
      continue;
    }
    const claim = CLAIM_FILE.exec(name);
    if (claim) claimed.add(claim[1]);
  }
  return { records, claimed };
}

/**
 * The path to name in `ADR-NNN already exists`. The claim holds the winner's
 * filename, so the loser can name a record that is not on disk yet. A released
 * claim means the winner finished, and the record itself is the answer.
 */
async function conflictingPath(
  decisionsDir: string,
  number: string,
): Promise<string> {
  try {
    const winner = String(
      await fs.readFile(claimPathFor(decisionsDir, number), "utf-8"),
    ).trim();
    if (winner) return path.join(decisionsDir, winner);
  } catch {
    // Released between the failed claim and this read.
  }

  const { records } = await readCorpus(decisionsDir);
  const taken = records.find((record) => record.number === number);
  if (taken) return path.join(decisionsDir, taken.name);

  return claimPathFor(decisionsDir, number);
}

/**
 * Walks parent directories for `.gwrkrc.json`, as `init.ts:26-30` does, so the
 * command works from any subdirectory of the project (US-001 scenario 3).
 */
export async function findProjectRoot(cwd: string): Promise<string> {
  let current = path.resolve(cwd);
  for (;;) {
    try {
      await fs.access(path.join(current, PROJECT_MARKER));
      return current;
    } catch {
      // Not here — keep climbing.
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(
    `Not a gwrk project: no ${PROJECT_MARKER} found in ${cwd} or any parent. Run: gwrk init`,
  );
}

/**
 * `project.architecture.decisions` is declared at `config.ts:86-95` and read by
 * nothing. One `loadConfig` call turns a declared-but-dead seam into the
 * configuration point (FR-019).
 *
 * `architecture` is `z.union([z.string(), z.object({doc, decisions})])`: a bare
 * string names the architecture doc, so `decisions` exists only on the object
 * form.
 *
 * Only an absent `.gwrkrc.json` falls back to the default (TC-014). A config
 * that is present but invalid rejects with the config error (TC-002), matching
 * `draftRecord` in `src/commands/adr.ts`, which calls the same `loadConfig`
 * unguarded. Swallowing it would write the record to the wrong directory and
 * split the verdict between the two callers (AMBER-4).
 */
export async function resolveDecisionsDir(
  projectRoot: string,
): Promise<string> {
  let configured: string | undefined;
  try {
    const config = loadConfig(projectRoot) as {
      project?: { architecture?: string | { decisions?: string } };
    };
    const architecture = config?.project?.architecture;
    if (architecture && typeof architecture === "object") {
      configured = architecture.decisions;
    }
  } catch (error: unknown) {
    // `scaffold` runs `findProjectRoot` first, which only returns a root that
    // holds a `.gwrkrc.json`, so the absent-file branch is unreachable from
    // there. It stays for direct callers. Every other error is a TC-002
    // fail-fast condition and propagates.
    const message = error instanceof Error ? error.message : String(error);
    if (!CONFIG_ABSENT.test(message)) throw error;
  }

  return path.join(projectRoot, configured || DEFAULT_DECISIONS_DIR);
}

/**
 * Max+1 over the corpus, zero-padded to three.
 *
 * A held number counts whether a record or a claim holds it. That is what keeps
 * a claim a crashed run left behind from wedging its number forever: the next
 * run steps over it to the following number rather than colliding with it on
 * every attempt.
 */
export async function allocateNumber(decisionsDir: string): Promise<string> {
  const { records, claimed } = await readCorpus(decisionsDir);
  const held = [...records.map((record) => record.number), ...claimed];
  const highest = held.reduce(
    (max, number) => Math.max(max, Number.parseInt(number, 10)),
    0,
  );
  return String(highest + 1).padStart(3, "0");
}

/**
 * `Decision Records & \`Index\` — v2!` → `decision-records-index-v2`. Punctuation
 * never reaches the filename.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The §4.1 template. Section numbers are the addresses `--amend --at` resolves
 * against (FR-020), and `## Amendments` is last, literal and unnumbered so
 * FR-022's `grep '^## Amendments'` resolves while FR-021's max+1 scan over
 * `## N.` headings does not see it (plan AMBER-2).
 */
export function renderTemplate(input: AdrTemplateInput): string {
  const id = `ADR-${input.number}`;
  return `# ${id}: ${input.title}

> **Status:** Proposed
> **Date:** ${input.date}
> **Decision:**
> **Constraint:**
> **Depends on:**
> **Supersedes:**
> **Author:** · **Decision Scope:**

---

## 1. Context

<!-- What forced this decision? Name the constraint, not the preference. -->

## 2. Decision

<!-- One numbered sub-heading per assertion. These are the addresses an
     amendment resolves against, so keep one claim per heading. -->

### 2.1 <assertion>

## 3. Decision Record

| Field | Value |
|---|---|
| Position | |
| Confidence | /10 |
| Reversibility | |
| Risk | |

## 4. Alternatives Rejected

<!-- What was considered and why it lost. An alternative with no reason is not
     a rejected alternative, it is a preference. -->

## 5. Impact on Existing Code

<!-- Files and behaviours this decision changes. -->

## 6. Consequences

<!-- What becomes easier, and what becomes harder. -->

## 7. References

<!-- Specs, research, prior records. -->

## Amendments

| Amending | Section | Summary |
|---|---|---|
`;
}

/**
 * Order of operations: root discovery → decisions dir → allocation → mkdir →
 * claim → existence check → write → release.
 *
 * The claim is the whole point. `link` grants it to exactly one writer, so two
 * runs that computed the same number cannot both reach the write. The loser
 * fails loudly naming the winner's path, which the claim's contents carry.
 *
 * The existence check runs AFTER the claim, not before. A run that completed
 * between this run's allocation read and its claim released its own claim on the
 * way out, so its record is only visible to a read taken after the claim
 * succeeds. Checking first would look at a corpus that predates it.
 *
 * The claim is released in a `finally`: the happy path leaves no litter, and a
 * crash leaves one visible `.ADR-NNN.claim` that costs the corpus one number.
 */
export async function scaffold(
  title: string,
  opts: AdrScaffoldOptions = {},
): Promise<AdrScaffoldResult> {
  const trimmed = (title ?? "").trim();
  if (!trimmed) {
    throw new Error('Title is required: gwrk define adr "<title>"');
  }

  const projectRoot = await findProjectRoot(opts.cwd ?? process.cwd());
  const decisionsDir = await resolveDecisionsDir(projectRoot);
  const number = await allocateNumber(decisionsDir);
  const id = `ADR-${number}`;

  const slug = slugify(trimmed);
  const fileName = `${id}-${slug}.md`;
  const filePath = path.join(decisionsDir, fileName);
  const claimPath = claimPathFor(decisionsDir, number);
  const dirLabel = `${path.relative(projectRoot, decisionsDir)}/`;

  try {
    await fs.mkdir(decisionsDir, { recursive: true });
  } catch (error: unknown) {
    throw new Error(`Cannot write ${dirLabel}: ${errnoOf(error)}`);
  }

  try {
    await claimNumber(decisionsDir, number, fileName);
  } catch (error: unknown) {
    if (isErrnoException(error) && error.code === "EEXIST") {
      const conflicting = await conflictingPath(decisionsDir, number);
      throw new Error(
        `${id} already exists: ${path.relative(projectRoot, conflicting)}`,
      );
    }
    throw new Error(`Cannot write ${dirLabel}: ${errnoOf(error)}`);
  }

  try {
    const { records } = await readCorpus(decisionsDir);
    const taken = records.find((record) => record.number === number);
    if (taken) {
      const conflicting = path.relative(
        projectRoot,
        path.join(decisionsDir, taken.name),
      );
      throw new Error(`${id} already exists: ${conflicting}`);
    }

    const body = renderTemplate({
      number,
      title: trimmed,
      date: new Date().toISOString().slice(0, 10),
    });

    try {
      await fs.writeFile(filePath, body, { encoding: "utf-8", flag: "wx" });
    } catch (error: unknown) {
      if (isErrnoException(error) && error.code === "EEXIST") {
        throw new Error(
          `${id} already exists: ${path.relative(projectRoot, filePath)}`,
        );
      }
      throw new Error(`Cannot write ${dirLabel}: ${errnoOf(error)}`);
    }
  } finally {
    await fs.unlink(claimPath).catch(() => {});
  }

  return { filePath, id, number, slug };
}
