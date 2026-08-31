/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * 029 Decision Records — RED tests for TR-001 (FR-002, FR-003, FR-019).
 *
 * @phase 02
 * @status active
 *
 * `node:fs/promises` is mocked wholesale (TR-001) and backed by an in-memory
 * tree so the three flaws of the research allocator are asserted directly:
 * suffix-AND-pattern filtering, loud failure on a taken number, and project-root
 * discovery by walking parents for `.gwrkrc.json`. `node:fs` is mocked from the
 * same tree so the assertions hold whichever API the implementation reaches for.
 *
 * The module under test is loaded with a dynamic `import` inside each test: a
 * top-level static import of a file that does not exist yet fails at COLLECTION,
 * which reports `Tests  no tests` and trips the ADR-005 §10.2.1 liveness check.
 */

import os from "node:os";
import path from "node:path";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

/** In-memory tree shared by both fs mocks. Keys are absolute POSIX paths. */
const tree = vi.hoisted(() => ({
  files: new Map<string, string>(),
  dirs: new Map<string, string[]>(),
}));

const enoent = (p: string) => {
  const err = new Error(`ENOENT: no such file or directory, '${p}'`) as Error & {
    code: string;
  };
  err.code = "ENOENT";
  return err;
};

const eexist = (p: string) => {
  const err = new Error(`EEXIST: file already exists, open '${p}'`) as Error & {
    code: string;
  };
  err.code = "EEXIST";
  return err;
};

/** Creating a file puts its basename in the parent listing, as a real one does. */
const linkIntoParent = (key: string): void => {
  const parent = key.slice(0, key.lastIndexOf("/"));
  const name = key.slice(key.lastIndexOf("/") + 1);
  const entries = tree.dirs.get(parent);
  if (entries && !entries.includes(name)) tree.dirs.set(parent, [...entries, name]);
};

const unlinkFromParent = (key: string): void => {
  const parent = key.slice(0, key.lastIndexOf("/"));
  const name = key.slice(key.lastIndexOf("/") + 1);
  const entries = tree.dirs.get(parent);
  if (entries) tree.dirs.set(parent, entries.filter((entry) => entry !== name));
};

vi.mock("node:fs/promises", () => {
  const readdir = vi.fn(async (p: unknown) => {
    const entries = tree.dirs.get(String(p));
    if (!entries) throw enoent(String(p));
    return entries;
  });
  const readFile = vi.fn(async (p: unknown) => {
    const content = tree.files.get(String(p));
    if (content === undefined) throw enoent(String(p));
    return content;
  });
  const stat = vi.fn(async (p: unknown) => {
    const key = String(p);
    if (tree.dirs.has(key)) {
      return { isDirectory: () => true, isFile: () => false };
    }
    if (tree.files.has(key)) {
      return { isDirectory: () => false, isFile: () => true };
    }
    throw enoent(key);
  });
  const access = vi.fn(async (p: unknown) => {
    const key = String(p);
    if (!tree.files.has(key) && !tree.dirs.has(key)) throw enoent(key);
  });
  const writeFile = vi.fn(
    async (p: unknown, content: unknown, options?: unknown) => {
      const key = String(p);
      const flag = (options as { flag?: string } | undefined)?.flag ?? "";
      if (flag.includes("x") && tree.files.has(key)) throw eexist(key);
      tree.files.set(key, String(content));
      linkIntoParent(key);
    },
  );
  const mkdir = vi.fn(async (p: unknown) => {
    if (!tree.dirs.has(String(p))) tree.dirs.set(String(p), []);
    return undefined;
  });
  const open = vi.fn(async (p: unknown, flags?: unknown) => {
    const key = String(p);
    if (String(flags ?? "").includes("x") && tree.files.has(key)) {
      throw eexist(key);
    }
    tree.files.set(key, "");
    linkIntoParent(key);
    return {
      writeFile: vi.fn(async (content: unknown) => {
        tree.files.set(key, String(content));
      }),
      close: vi.fn(async () => undefined),
    };
  });
  // The mechanism the number claim rests on: link refuses an existing target,
  // and publishes a file that already has its contents.
  const link = vi.fn(async (existing: unknown, next: unknown) => {
    const from = String(existing);
    const to = String(next);
    if (tree.files.has(to) || tree.dirs.has(to)) throw eexist(to);
    const content = tree.files.get(from);
    if (content === undefined) throw enoent(from);
    tree.files.set(to, content);
    linkIntoParent(to);
  });
  const unlink = vi.fn(async (p: unknown) => {
    const key = String(p);
    if (!tree.files.has(key)) throw enoent(key);
    tree.files.delete(key);
    unlinkFromParent(key);
  });
  const api = {
    readdir,
    readFile,
    stat,
    access,
    writeFile,
    mkdir,
    open,
    link,
    unlink,
  };
  return { ...api, default: api };
});

vi.mock("node:fs", () => {
  const existsSync = vi.fn(
    (p: unknown) => tree.files.has(String(p)) || tree.dirs.has(String(p)),
  );
  const readFileSync = vi.fn((p: unknown) => {
    const content = tree.files.get(String(p));
    if (content === undefined) throw enoent(String(p));
    return content;
  });
  const readdirSync = vi.fn((p: unknown) => {
    const entries = tree.dirs.get(String(p));
    if (!entries) throw enoent(String(p));
    return entries;
  });
  const mkdirSync = vi.fn((p: unknown) => {
    if (!tree.dirs.has(String(p))) tree.dirs.set(String(p), []);
  });
  const writeFileSync = vi.fn((p: unknown, content: unknown) => {
    tree.files.set(String(p), String(content));
  });
  const statSync = vi.fn((p: unknown) => {
    const key = String(p);
    if (tree.dirs.has(key)) return { isDirectory: () => true, isFile: () => false };
    if (tree.files.has(key)) return { isDirectory: () => false, isFile: () => true };
    throw enoent(key);
  });
  const api = {
    existsSync,
    readFileSync,
    readdirSync,
    mkdirSync,
    writeFileSync,
    statSync,
  };
  return { ...api, default: api };
});

/** FR-019: the declared-but-dead `project.architecture.decisions` seam. */
const configMock = vi.hoisted(() => ({
  loadConfig: vi.fn(),
}));
vi.mock("../utils/config.js", () => configMock);

/**
 * Ids assembled from parts on purpose: FR-024 assertion 1 treats every bare
 * `ADR-NNN` under `src/` as a citation that MUST resolve, and these fixtures
 * name records that deliberately do not exist. Interpolating keeps
 * `gwrk define adr --check` from reading a fixture as a real citation.
 */
const adr = (n: string) => `ADR-${n}`;

const load = () => import("./adr-scaffold.js");

const ROOT = "/repo";
const DECISIONS = "/repo/docs/decisions";

/** Seed a nine-record corpus plus the project marker. */
function seedCorpus(entries: string[] = nineRecords()): void {
  tree.files.clear();
  tree.dirs.clear();
  tree.dirs.set(ROOT, [".gwrkrc.json", "docs", "src"]);
  tree.files.set("/repo/.gwrkrc.json", JSON.stringify({ project: { name: "gwrk" } }));
  tree.dirs.set("/repo/docs", ["decisions"]);
  tree.dirs.set(DECISIONS, entries);
  for (const entry of entries) {
    if (entry.endsWith(".md")) {
      tree.files.set(`${DECISIONS}/${entry}`, `# ${entry}\n`);
    }
  }
}

function nineRecords(): string[] {
  return [
    "ADR-001-task-tracking.md",
    "ADR-002-sqlite-execution-ledger.md",
    "ADR-003-state-contract.md",
    "ADR-004-agent-native-output.md",
    "ADR-005-tdd-gate-architecture.md",
    "ADR-006-plugin-agent-backends.md",
    "ADR-007-single-dispatch-path.md",
    "ADR-008-command-safety-posture.md",
    "ADR-009-domain-ontology-information-hierarchy-ux.md",
  ];
}

async function writeFileMock() {
  const fsp = await import("node:fs/promises");
  return vi.mocked(fsp.writeFile);
}

/**
 * Puts the corpus into the one state in which the allocated number is taken.
 *
 * Max+1 over a listing is free by construction against that same listing — no
 * allocation rule (max+1, first-gap, count+1) can return a number a static
 * fixture already holds. The taken number is therefore reachable only through
 * TC-015's accepted race: no locking, so a concurrent run lands the record
 * between this run's allocation read and its existence check. The next
 * `readdir` returns the corpus the allocation is computed from and plants
 * `entry` for every read after it, which is precisely that interleaving.
 */
async function plantConcurrentWriter(entry: string): Promise<void> {
  const fsp = await import("node:fs/promises");
  const readdir = fsp.readdir as unknown as {
    mockImplementationOnce(fn: (p: unknown) => Promise<string[]>): void;
  };
  readdir.mockImplementationOnce(async (p: unknown) => {
    const key = String(p);
    const entries = tree.dirs.get(key) ?? [];
    tree.dirs.set(key, [...entries, entry]);
    tree.files.set(`${key}/${entry}`, `# ${entry}\n`);
    return entries;
  });
}

describe("029 FR-002: allocation and project-root discovery (US-001)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedCorpus();
    configMock.loadConfig.mockReturnValue({ project: { name: "gwrk" } });
  });

  it("FR-002: allocates max plus 1 over the existing corpus", async () => {
    const { allocateNumber } = await load();

    // Nine records on disk → the next number is 010, zero-padded to three.
    await expect(allocateNumber(DECISIONS)).resolves.toBe("010");
  });

  it("FR-002: filters on the .md suffix and the ADR-NNN pattern", async () => {
    const { allocateNumber } = await load();

    seedCorpus([
      "ADR-001-task-tracking.md",
      "ADR-002-sqlite-execution-ledger.md",
      "ADR-003-state-contract.md",
      "README.md", // markdown, not a record
      "ADR-9-badly-numbered.md", // pattern miss: not zero-padded to three
      `${adr("042")}-not-markdown.txt`, // pattern hit, suffix miss
    ]);
    tree.dirs.set(`${DECISIONS}/${adr("050")}-a-directory`, []); // a directory, never read
    tree.dirs.set(DECISIONS, [
      ...(tree.dirs.get(DECISIONS) ?? []),
      `${adr("050")}-a-directory`,
    ]);

    // A raw readdir would allocate 043 or 051. Filtering on BOTH the suffix and
    // the pattern is what makes 004 correct.
    await expect(allocateNumber(DECISIONS)).resolves.toBe("004");
  });

  it("FR-002: allocates 001 into an empty corpus", async () => {
    const { allocateNumber } = await load();

    seedCorpus([]);

    await expect(allocateNumber(DECISIONS)).resolves.toBe("001");
  });

  it("FR-002: discovers the project root by walking parents for .gwrkrc.json", async () => {
    const { findProjectRoot } = await load();

    seedCorpus();
    tree.dirs.set("/repo/src/engine/deep", []);

    // US-001 scenario 3: the command works from any subdirectory. Joining
    // process.cwd() with literals is the third flaw of the research allocator.
    await expect(findProjectRoot("/repo/src/engine/deep")).resolves.toBe(ROOT);
    await expect(findProjectRoot(ROOT)).resolves.toBe(ROOT);
  });

  it("FR-002: fails with the corrective command when no .gwrkrc.json is in any parent", async () => {
    const { findProjectRoot } = await load();

    tree.files.clear();
    tree.dirs.clear();
    tree.dirs.set("/elsewhere/project", []);

    await expect(findProjectRoot("/elsewhere/project")).rejects.toThrow(
      /Not a gwrk project: no \.gwrkrc\.json found in \/elsewhere\/project or any parent\. Run: gwrk init/,
    );
  });

  it("FR-002: fails loudly on a same-number different-slug collision", async () => {
    const { scaffold } = await load();

    await plantConcurrentWriter("ADR-010-something-else.md");

    // Silently writing a sibling at a taken number is the second flaw of the
    // research allocator. The message names the conflicting path.
    await expect(scaffold("Decision Records", { cwd: ROOT })).rejects.toThrow(
      /ADR-010 already exists: .*ADR-010-something-else\.md/,
    );
  });

  it("FR-002: does not write when the number is taken", async () => {
    const { scaffold } = await load();
    const writeFile = await writeFileMock();

    await plantConcurrentWriter("ADR-010-something-else.md");
    await expect(scaffold("Decision Records", { cwd: ROOT })).rejects.toThrow();

    expect(writeFile).not.toHaveBeenCalled();
  });

  it("FR-002: fails on an empty title without writing", async () => {
    const { scaffold } = await load();
    const writeFile = await writeFileMock();

    await expect(scaffold("", { cwd: ROOT })).rejects.toThrow(
      /Title is required: gwrk define adr "<title>"/,
    );
    await expect(scaffold("   ", { cwd: ROOT })).rejects.toThrow(/Title is required/);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("FR-002: writes the allocated path and returns it", async () => {
    const { scaffold } = await load();
    const writeFile = await writeFileMock();

    const result = await scaffold("Decision Records", { cwd: ROOT });

    expect(result.id).toBe("ADR-010");
    expect(result.number).toBe("010");
    expect(result.slug).toBe("decision-records");
    expect(result.filePath).toContain("ADR-010-decision-records.md");
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(String(writeFile.mock.calls[0][0])).toMatch(
      /ADR-010-decision-records\.md$/,
    );
  });

  it("FR-002: surfaces an unwritable decisions directory with its errno", async () => {
    const { scaffold } = await load();
    const fsp = await import("node:fs/promises");

    vi.mocked(fsp.writeFile).mockRejectedValueOnce(
      Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }),
    );

    await expect(scaffold("Decision Records", { cwd: ROOT })).rejects.toThrow(
      /Cannot write .*decisions.*EACCES/s,
    );
  });
});

describe("029 FR-003: the section-numbered template (US-001)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedCorpus();
    configMock.loadConfig.mockReturnValue({ project: { name: "gwrk" } });
  });

  it("FR-003: writes the section-numbered template with Status Proposed", async () => {
    const { scaffold } = await load();
    const writeFile = await writeFileMock();

    await scaffold("Decision Records", { cwd: ROOT });
    const body = String(writeFile.mock.calls[0][1]);

    expect(body.split("\n")[0]).toBe("# ADR-010: Decision Records");
    expect(body).toContain("> **Status:** Proposed");
    expect(body).toContain("> **Decision:**");
    expect(body).toContain("> **Constraint:**");
    expect(body).toContain("> **Author:**");
    expect(body).toContain("**Decision Scope:**");
    // Numbered sections §1–§7 plus the numbered assertion sub-headings of §2.
    expect(body).toContain("\n## 1. Context");
    expect(body).toContain("\n## 2. Decision");
    expect(body).toMatch(/\n### 2\.1 /);
    expect(body).toContain("\n## 3. Decision Record");
    expect(body).toContain("\n## 4. Alternatives Rejected");
    expect(body).toContain("\n## 5. Impact on Existing Code");
    expect(body).toContain("\n## 6. Consequences");
    expect(body).toContain("\n## 7. References");
  });

  it("FR-003: stamps today's date, not a hardcoded one", async () => {
    const { renderTemplate } = await load();

    const body = renderTemplate({
      number: "010",
      title: "Decision Records",
      date: "2026-08-20",
    });

    expect(body).toContain("> **Date:** 2026-08-20");
  });

  it("FR-003: uses the four-row Decision Record table used by 004-009", async () => {
    const { renderTemplate } = await load();

    const body = renderTemplate({
      number: "010",
      title: "Decision Records",
      date: "2026-08-20",
    });
    const table = body.slice(body.indexOf("## 3. Decision Record"));

    // MUST NOT introduce a fourth table shape (contract §3).
    expect(table).toMatch(/\|\s*Position\s*\|/);
    expect(table).toMatch(/\|\s*Confidence\s*\|/);
    expect(table).toMatch(/\|\s*Reversibility\s*\|/);
    expect(table).toMatch(/\|\s*Risk\s*\|/);
  });

  it("FR-003: ends with a literal unnumbered ## Amendments registry, starting empty", async () => {
    const { renderTemplate } = await load();

    const body = renderTemplate({
      number: "010",
      title: "Decision Records",
      date: "2026-08-20",
    });

    // Plan AMBER-2: the registry is `## Amendments`, unnumbered and last, so
    // FR-022's `grep '^## Amendments'` resolves and FR-021's max+1 scan over
    // `## N.` headings does not see it.
    expect(body).toMatch(/^## Amendments$/m);
    expect(body).not.toMatch(/^## 8\. Amendments$/m);
    const afterRegistry = body.slice(body.indexOf("\n## Amendments"));
    expect(afterRegistry).not.toMatch(/^## \d+\. /m);
    // Starting empty: no amendment rows yet.
    expect(afterRegistry).not.toMatch(/^\| 0\d\d /m);
  });

  it("FR-003: slugifies the title without leaking punctuation into the filename", async () => {
    const { scaffold } = await load();
    const writeFile = await writeFileMock();

    const result = await scaffold("Decision Records & `Index` — v2!", { cwd: ROOT });

    expect(result.slug).toMatch(/^[a-z0-9-]+$/);
    expect(String(writeFile.mock.calls[0][0])).toMatch(/ADR-010-[a-z0-9-]+\.md$/);
  });
});

describe("029 FR-019: project.architecture.decisions is the configuration point (US-001)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedCorpus();
  });

  it("FR-019: honours project.architecture.decisions from loadConfig", async () => {
    const { resolveDecisionsDir } = await load();

    configMock.loadConfig.mockReturnValue({
      project: { architecture: { doc: "docs/arch.md", decisions: "docs/adr" } },
    });

    await expect(resolveDecisionsDir(ROOT)).resolves.toBe("/repo/docs/adr");
  });

  it("FR-019: defaults to docs/decisions when architecture is the bare string form", async () => {
    const { resolveDecisionsDir } = await load();

    // `architecture` is z.union([z.string(), z.object({doc, decisions})]) — a
    // bare string means the architecture doc, so `decisions` is absent.
    configMock.loadConfig.mockReturnValue({ project: { architecture: "Layered" } });

    await expect(resolveDecisionsDir(ROOT)).resolves.toBe(DECISIONS);
  });

  it("FR-019: defaults to docs/decisions when the field is absent", async () => {
    const { resolveDecisionsDir } = await load();

    configMock.loadConfig.mockReturnValue({ project: { name: "gwrk" } });

    await expect(resolveDecisionsDir(ROOT)).resolves.toBe(DECISIONS);
  });

  it("FR-019: defaults to docs/decisions when .gwrkrc.json is absent", async () => {
    const { resolveDecisionsDir } = await load();

    configMock.loadConfig.mockImplementation(() => {
      throw new Error(
        "Configuration file .gwrkrc.json not found at /repo/.gwrkrc.json",
      );
    });

    // TC-014 bare-clone operable: an absent config still authors a decision.
    await expect(resolveDecisionsDir(ROOT)).resolves.toBe(DECISIONS);
  });

  it("TC-002: rejects when .gwrkrc.json is present but invalid", async () => {
    const { resolveDecisionsDir } = await load();

    // The only errors reachable from `scaffold` — `findProjectRoot` runs first
    // and guarantees the file exists. Swallowing this writes to the wrong
    // directory and contradicts `draftRecord`, which never guarded it (AMBER-4).
    configMock.loadConfig.mockImplementation(() => {
      throw new Error("Invalid .gwrkrc.json: project.name Required");
    });

    await expect(resolveDecisionsDir(ROOT)).rejects.toThrow(/project\.name/);
  });

  it("TC-002: rejects when .gwrkrc.json holds invalid JSON", async () => {
    const { resolveDecisionsDir } = await load();

    configMock.loadConfig.mockImplementation(() => {
      throw new Error("Configuration error: invalid JSON in .gwrkrc.json");
    });

    await expect(resolveDecisionsDir(ROOT)).rejects.toThrow(/invalid JSON/);
  });
});

/**
 * The mocked suite above cannot catch the concurrent-allocation defect: an
 * in-memory tree driven by `mockImplementationOnce` forces one interleaving,
 * and the one it forces is not the one two real runs produce. Two real runs both
 * finish reading the corpus before either writes, so a check-then-write allocator
 * lets BOTH through and lands two records at the same number.
 *
 * This block therefore drops the mocks and drives real `scaffold()` calls
 * against a real temp directory. `vi.doUnmock` is not hoisted, so it takes
 * effect from here on — which is why this is the last block in the file.
 */
describe("029 FR-002: concurrent allocation on a real filesystem (US-001, TC-015)", () => {
  let realFs: typeof import("node:fs/promises");
  let root = "";
  let decisions = "";

  beforeAll(async () => {
    realFs = (await vi.importActual(
      "node:fs/promises",
    )) as typeof import("node:fs/promises");
    vi.doUnmock("node:fs/promises");
    vi.doUnmock("node:fs");
    vi.resetModules();
  });

  beforeEach(async () => {
    configMock.loadConfig.mockReturnValue({ project: { name: "gwrk" } });
    root = await realFs.mkdtemp(path.join(os.tmpdir(), "gwrk-adr-race-"));
    decisions = path.join(root, "docs", "decisions");
    await realFs.mkdir(decisions, { recursive: true });
    await realFs.writeFile(
      path.join(root, ".gwrkrc.json"),
      JSON.stringify({ project: { name: "gwrk" } }),
    );
    await realFs.writeFile(
      path.join(decisions, "ADR-001-task-tracking.md"),
      "# ADR-001: Task Tracking\n",
    );
  });

  afterEach(async () => {
    await realFs.rm(root, { recursive: true, force: true });
  });

  const records = async (): Promise<string[]> =>
    (await realFs.readdir(decisions))
      .filter((name) => /^ADR-\d{3}-.*\.md$/.test(name))
      .sort();

  it("FR-002: two overlapping runs land exactly one record at the number", async () => {
    const { scaffold } = await import("./adr-scaffold.js");

    const settled = await Promise.allSettled([
      scaffold("Alpha One", { cwd: root }),
      scaffold("Beta Two", { cwd: root }),
    ]);

    // The invariant, whichever run wins: never two records at one number.
    const written = await records();
    expect(written.filter((name) => name.startsWith("ADR-002-"))).toHaveLength(1);
    expect(new Set(written.map((name) => name.slice(0, 7))).size).toBe(
      written.length,
    );

    // Both computed 002, so exactly one is refused, naming the winner's path.
    const rejected = settled.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(
      /ADR-002 already exists: docs\/decisions\/ADR-002-(alpha-one|beta-two)\.md/,
    );
    expect(written).toHaveLength(2);
    expect(written[0]).toBe("ADR-001-task-tracking.md");
  });

  it("FR-002: neither run leaves a claim or a stage file behind", async () => {
    const { scaffold } = await import("./adr-scaffold.js");

    await Promise.allSettled([
      scaffold("Alpha One", { cwd: root }),
      scaffold("Beta Two", { cwd: root }),
    ]);

    // Records only: `docs/decisions/` stays a directory a human can read.
    const leftovers = (await realFs.readdir(decisions)).filter(
      (name) => !/^ADR-\d{3}-.*\.md$/.test(name),
    );
    expect(leftovers).toEqual([]);
  });

  it("FR-002: a claim a crashed run left behind costs one number, not the command", async () => {
    const { scaffold } = await import("./adr-scaffold.js");

    // What a SIGKILL between claim and release leaves on disk.
    await realFs.writeFile(
      path.join(decisions, ".ADR-002.claim"),
      "ADR-002-never-written.md",
    );

    const result = await scaffold("Alpha One", { cwd: root });

    expect(result.id).toBe("ADR-003");
    expect(await records()).toEqual([
      "ADR-001-task-tracking.md",
      "ADR-003-alpha-one.md",
    ]);
  });

  it("FR-002: a sequential second run allocates the next number", async () => {
    const { scaffold } = await import("./adr-scaffold.js");

    const first = await scaffold("Alpha One", { cwd: root });
    const second = await scaffold("Beta Two", { cwd: root });

    expect([first.id, second.id]).toEqual(["ADR-002", "ADR-003"]);
    expect(await records()).toEqual([
      "ADR-001-task-tracking.md",
      "ADR-002-alpha-one.md",
      "ADR-003-beta-two.md",
    ]);
  });
});

/**
 * AMBER-4: which `loadConfig` failures reach the user.
 *
 * The suites above mock `../utils/config.js`, so they can assert what
 * `resolveDecisionsDir` does with a thrown error but never which errors a real
 * config produces. That gap is what let a bare `catch {}` ship: it was justified
 * as TC-014 bare-clone tolerance, and the mocked test fed it the one error
 * `scaffold` can never see, because `findProjectRoot` runs first and only
 * returns a root that holds a `.gwrkrc.json`.
 *
 * This block drops the config mock as well as the fs mocks and drives real
 * `scaffold()` calls against real temp projects.
 */
describe("029 FR-019/TC-002: real config resolution", () => {
  let realFs: typeof import("node:fs/promises");
  let root = "";

  beforeAll(async () => {
    realFs = (await vi.importActual(
      "node:fs/promises",
    )) as typeof import("node:fs/promises");
    vi.doUnmock("node:fs/promises");
    vi.doUnmock("node:fs");
    vi.doUnmock("../utils/config.js");
    vi.resetModules();
  });

  beforeEach(async () => {
    root = await realFs.mkdtemp(path.join(os.tmpdir(), "gwrk-adr-config-"));
  });

  afterEach(async () => {
    await realFs.rm(root, { recursive: true, force: true });
  });

  const writeConfig = async (config: unknown): Promise<void> => {
    await realFs.writeFile(
      path.join(root, ".gwrkrc.json"),
      JSON.stringify(config),
    );
  };

  /** Every `ADR-NNN-*.md` anywhere under the temp root, relative to it. */
  const allRecords = async (dir = root): Promise<string[]> => {
    const found: string[] = [];
    for (const entry of await realFs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) found.push(...(await allRecords(full)));
      else if (/^ADR-\d{3}-.*\.md$/.test(entry.name))
        found.push(path.relative(root, full));
    }
    return found;
  };

  it("FR-019: writes to the configured decisions directory", async () => {
    const { scaffold } = await import("./adr-scaffold.js");

    await writeConfig({
      project: { name: "gwrk", architecture: { decisions: "docs/adr" } },
    });

    const result = await scaffold("Configured Dir", { cwd: root });

    expect(path.relative(root, result.filePath)).toBe(
      path.join("docs", "adr", "ADR-001-configured-dir.md"),
    );
    expect(await allRecords()).toEqual([
      path.join("docs", "adr", "ADR-001-configured-dir.md"),
    ]);
    await expect(
      realFs.access(path.join(root, "docs", "decisions")),
    ).rejects.toThrow();
  });

  it("TC-002: a schema-invalid config rejects instead of defaulting", async () => {
    const { scaffold } = await import("./adr-scaffold.js");

    // Valid JSON, valid `decisions`, missing the required `project.name`. The
    // bare catch returned `docs/decisions` here and exited 0, ignoring the
    // configured `docs/adr` with no message.
    await writeConfig({ project: { architecture: { decisions: "docs/adr" } } });

    await expect(scaffold("Configured Dir", { cwd: root })).rejects.toThrow(
      /Configuration error in \.gwrkrc\.json/,
    );
    await expect(
      realFs.access(path.join(root, "docs", "decisions")),
    ).rejects.toThrow();
    expect(await allRecords()).toEqual([]);
  });

  it("TC-002: a config holding invalid JSON rejects instead of defaulting", async () => {
    const { scaffold } = await import("./adr-scaffold.js");

    await realFs.writeFile(path.join(root, ".gwrkrc.json"), "{ not json");

    await expect(scaffold("Broken Json", { cwd: root })).rejects.toThrow(
      /invalid JSON/,
    );
    expect(await allRecords()).toEqual([]);
  });
});
