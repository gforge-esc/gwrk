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
 * No locking (TC-015): two concurrent runs compute the same number and the
 * existence check makes the second fail loudly. A lockfile is out of proportion
 * to a human-paced command.
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
 * The `.md` suffix AND the record pattern (FR-002). A raw readdir is the first
 * flaw of the research allocator: a stray `notes.txt`, a `README.md` or a
 * directory would all skew the allocation.
 */
const RECORD_FILE = /^ADR-(\d{3})-.*\.md$/;

/** One directory entry that is a record, with its number already extracted. */
interface RecordEntry {
  name: string;
  number: string;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/** Reads the corpus, keeping only the entries FR-002 counts as records. */
async function readRecordEntries(decisionsDir: string): Promise<RecordEntry[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(decisionsDir);
  } catch (error: unknown) {
    // A project that has never recorded a decision is not an error state: the
    // first `gwrk define adr` creates the directory on its way to writing 001.
    if (isErrnoException(error) && error.code === "ENOENT") return [];
    throw error;
  }

  const records: RecordEntry[] = [];
  for (const name of entries) {
    const match = RECORD_FILE.exec(String(name));
    if (match) records.push({ name: String(name), number: match[1] });
  }
  return records;
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
 * form. An unreadable config falls back to the default rather than throwing —
 * authoring a decision must not require a readable config (TC-014).
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
  } catch {
    // TC-014 bare-clone operable.
  }

  return path.join(projectRoot, configured || DEFAULT_DECISIONS_DIR);
}

/**
 * Max+1 over the corpus, zero-padded to three. No locking (TC-015).
 */
export async function allocateNumber(decisionsDir: string): Promise<string> {
  const records = await readRecordEntries(decisionsDir);
  const highest = records.reduce(
    (max, record) => Math.max(max, Number.parseInt(record.number, 10)),
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
 * Order of operations: root discovery → decisions dir → allocation → existence
 * check → mkdir → write. On a collision `writeFile` is never called: writing a
 * sibling at a taken number is the second flaw of the research allocator.
 *
 * The existence check re-reads the corpus rather than reusing the listing the
 * allocation was computed from. Max+1 over a snapshot is free by construction
 * against that same snapshot, so checking the stale listing would be checking
 * nothing: the only state that can take the number is one that landed after the
 * allocation read. That is exactly the unlocked concurrent run TC-015 accepts,
 * and re-reading as late as possible before the write is what catches it.
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

  // Existence check before the write, not after: the allocation is unlocked, so
  // a concurrent run may have taken this number since it was computed.
  const taken = (await readRecordEntries(decisionsDir)).find(
    (record) => record.number === number,
  );
  if (taken) {
    const conflicting = path.relative(
      projectRoot,
      path.join(decisionsDir, taken.name),
    );
    throw new Error(`${id} already exists: ${conflicting}`);
  }

  const slug = slugify(trimmed);
  const filePath = path.join(decisionsDir, `${id}-${slug}.md`);
  const body = renderTemplate({
    number,
    title: trimmed,
    date: new Date().toISOString().slice(0, 10),
  });

  try {
    await fs.mkdir(decisionsDir, { recursive: true });
    // `wx` closes the window the re-read above leaves open: between the check
    // and the write, an exclusive create is the only thing that can refuse a
    // clobber atomically. It guards this exact filename; the re-read is what
    // guards the number against a different slug.
    await fs.writeFile(filePath, body, { encoding: "utf-8", flag: "wx" });
  } catch (error: unknown) {
    const code = isErrnoException(error) ? error.code : undefined;
    if (code === "EEXIST") {
      throw new Error(
        `${id} already exists: ${path.relative(projectRoot, filePath)}`,
      );
    }
    const detail =
      code ?? (error instanceof Error ? error.message : `${error}`);
    throw new Error(
      `Cannot write ${path.relative(projectRoot, decisionsDir)}/: ${detail}`,
    );
  }

  return { filePath, id, number, slug };
}
