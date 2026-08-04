# Gap-Matrix Parser Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `parseGapMatrix` read gap-matrix tables by column *name* instead of position, and close the two false-green surfaces that hid the resulting data loss.

**Architecture:** `parseGapMatrix` currently splits each table row on `|`, drops empty cells, and destructures the survivors by fixed index. Any authored matrix with an empty `Gate` cell (all of them, in practice) loses its last cell; any matrix carrying an extra `Phase` column has every field shifted. The fix resolves each required column's index from the header row once, then reads cells positionally *by that index*, never filtering. Gate IDs are then validated against real task IDs, the gate runner stops being emitted when it would have nothing to run, and gate-generation failure stops being downgraded to a warning.

**Tech Stack:** TypeScript (strict, ESM, `.js` import specifiers), vitest, biome.

## Background — the measured defect

Against the installed `1.4.0-alpha.1` `dist/`, over the six `data-dashboard` features
in `~/Projects/Data/.dd-define-wt/`: **~256 table rows → 4 parsed → 2 gate files, both
misnamed** (`3-gate.sh`, `2, 3-gate.sh`). Three distinct drop mechanisms, all rooted in
`gate-gen.ts:355` (`.filter((c) => c.length > 0)`) plus `gate-gen.ts:359` (fixed-index
destructure):

| Authored layout | Features | After empty-`Gate` cell is filtered out | Result |
|---|---|---|---|
| 6-col canonical | 005, 007, 010 | 6→5 cells, trips `cells.length < 6` | every row dropped |
| 7-col, `Phase` at col 3 | 008, 011 | `testType` reads `"1 + 3"`, fails whitelist | every row dropped |
| 7-col, `Phase` at col 6 | 009 | `gate` reads `"3"` / `"2, 3"` | 2 misnamed gate files |

Verified non-causes (do **not** "fix" these):
- **Not a regression.** `parseGapMatrix` last changed 2026-03-17 (`021b3de`); the 025/026 gate work never touched it.
- **Not the appended second table.** Stripping 009's 4-column RED-status table and re-parsing yields *identical* output (`parsed=4`, `gateIds=["3","2, 3"]`). The bad IDs come from the **main** table's `Phase` column. Scoping the parser to one table would not fix 009.
- **Not reachable via the `row.gate` skip at `gate-gen.ts:467`.** Rows die inside `parseGapMatrix`, so they never increment `skipped` — `define` logged `gates: 0 generated, 0 skipped` and looked healthy.
- All 16 of gwrk's own gap-matrices use the canonical 6-column header, which is why the repo never self-detected this.

## Global Constraints

- **All PRs target `develop`, never `main`.** Base every `gh pr create` on `develop`.
- Commit author must be **David Gonzalez <dgonzalez@wisecode.ai>**; trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Never run `gwrk ship` or the autonomous daemon.** Verify only via `npm run build` + `npm run test:ci` + targeted vitest runs.
- `npm run test:ci` sets `GWRK_SKIP_INTEGRATION=1`. Known-failing locally: 3 tests in `server.test.ts`. Any *other* failure is a real regression.
- The installed `gwrk` runs compiled `dist/`, so nothing in this plan changes real `gwrk` behavior until `npm run build`.
- Imports use `.js` specifiers even for `.ts` sources (ESM + `moduleResolution: node16`).
- Run `npm run lint` (biome) before each commit. **`develop` is not lint-clean —
  baseline is 339 errors across 270 files, and `gate-gen.ts` carries 1 pre-existing
  finding (import order + formatting in untouched code).** The bar is therefore
  *"introduces no new findings"*, not zero. Verify by comparing counts against
  `origin/develop`; do not mass-reformat untouched code to chase a clean run.
- **Do not touch `src/utils/gate-exec.ts`.** Strategy order (convention file → `gateScript` path → inline) is out of scope; the gates/ channel stays.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/utils/gate-gen.ts` | gap-matrix parsing, gate generation, runner emission | Modify — `parseGapMatrix`, `normalizeTestType` (new), `generateDeterministicGates`, `generateRunner` |
| `src/utils/gate-gen.test.ts` | unit coverage for the above | Modify — new describe blocks for each task |
| `src/engine/define-orchestrator.ts:411-430` | the one live caller of gate generation | Modify — stop swallowing gate-generation errors |
| `specs/000-tdd-infrastructure/contracts/gap-matrix.md` | the declared column contract | Modify — document name-based matching, extra columns, compound Test Type, `Gate` = task ID |

`parseGapMatrix` has exactly one production caller (`generateDeterministicGates`, `gate-gen.ts:407`), so the new throw has one blast site. `src/commands/tasks-generate.ts:24-26` imports the three generators but never calls them — dead imports, leave them alone.

---

### Task 1: Parse the gap-matrix header by column name

Resolve each required column's index from the header once; read cells at those indices without ever filtering empties. Rows whose width differs from the header are foreign-table rows and are skipped. A header missing a required column throws instead of silently yielding garbage.

**Files:**
- Modify: `src/utils/gate-gen.ts:313-387` (types + `parseGapMatrix`)
- Test: `src/utils/gate-gen.test.ts` (new describe after the existing `parseGapMatrix (TR-011)` block, which ends at line 257)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `export class GapMatrixHeaderError extends Error` with `readonly header: string[]` and `readonly missing: string[]`.
  - `parseGapMatrix(gapMatrixPath: string): GapMatrixRow[]` — unchanged signature, now throws `GapMatrixHeaderError`.
  - `GapMatrixRow` gains no fields; `testType` stays the same union (Task 2 changes how it is derived).

- [ ] **Step 1: Write the failing tests**

Append to `src/utils/gate-gen.test.ts`. Import `GapMatrixHeaderError` by adding it to the existing import from `./gate-gen.js` at the top of the file.

```ts
describe("parseGapMatrix — column-name resolution (028 regression)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gap-matrix-cols-"));
  });
  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function write(md: string): string {
    const p = path.join(tempDir, "gap-matrix.md");
    fs.writeFileSync(p, md);
    return p;
  }

  // 005/007/010 shape: canonical 6 columns, Gate column empty on every row.
  // Previously: the empty cell was filtered out, leaving 5 cells, tripping
  // `cells.length < 6` — the row vanished.
  it("keeps a canonical row whose Gate cell is empty", () => {
    const rows = parseGapMatrix(
      write(
        `| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-001 | some criterion | unit | tests/a.test.js | ✅ |  |
`,
      ),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].ac).toBe("FR-001");
    expect(rows[0].testType).toBe("unit");
    expect(rows[0].testFile).toBe("tests/a.test.js");
    expect(rows[0].testExists).toBe(true);
    expect(rows[0].gate).toBeNull();
  });

  // 009 shape: extra `Phase` column sits BETWEEN Test Exists and Gate. The
  // Phase value ("2, 3") used to be read as the gate id, producing the file
  // `2, 3-gate.sh`.
  it("does not mistake a trailing Phase column for the Gate column", () => {
    const rows = parseGapMatrix(
      write(
        `| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Phase | Gate |
|----|---------------------|-----------|-----------|-------------|-------|------|
| FR-008 | some criterion | unit | tests/today.test.js | ✅ | 2, 3 |  |
`,
      ),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].gate).toBeNull();
    expect(rows[0].testType).toBe("unit");
    expect(rows[0].testFile).toBe("tests/today.test.js");
  });

  // 008/011 shape: extra `Phase` column sits at index 2, so the fixed-index
  // destructure read it as Test Type ("1 + 3") and failed the whitelist.
  it("does not mistake a leading Phase column for Test Type", () => {
    const rows = parseGapMatrix(
      write(
        `| AC | Acceptance Criterion | Phase | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-------|-----------|-----------|-------------|------|
| FR-002 | some criterion | 1 + 3 | unit | tests/b.test.js | ✅ | T002 |
`,
      ),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].testType).toBe("unit");
    expect(rows[0].testFile).toBe("tests/b.test.js");
    expect(rows[0].gate).toBe("T002");
  });

  it("ignores rows from a foreign table of different width", () => {
    const rows = parseGapMatrix(
      write(
        `| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-001 | real row | unit | tests/a.test.js | ✅ | T001 |

## RED status

| Suite | Phase | Result | Why it is RED |
|-------|-------|--------|---------------|
| ragb.test.js | 2 | # fail 1 | _lib/ragb.js absent |
`,
      ),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].ac).toBe("FR-001");
  });

  it("ignores a repeated header row inside the table", () => {
    const rows = parseGapMatrix(
      write(
        `| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-001 | real row | unit | tests/a.test.js | ✅ | T001 |
| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
| FR-002 | after the repeat | unit | tests/b.test.js | ✅ | T002 |
`,
      ),
    );

    expect(rows.map((r) => r.ac)).toEqual(["FR-001", "FR-002"]);
  });

  it("throws GapMatrixHeaderError naming the missing column", () => {
    const p = write(
      `| AC | Acceptance Criterion | Test Type | Test File | Test Exists |
|----|---------------------|-----------|-----------|-------------|
| FR-001 | no gate column at all | unit | tests/a.test.js | ✅ |
`,
    );

    expect(() => parseGapMatrix(p)).toThrow(GapMatrixHeaderError);
    expect(() => parseGapMatrix(p)).toThrow(/Gate/);
  });

  it("still returns [] for a missing file and for a file with no table", () => {
    expect(parseGapMatrix(path.join(tempDir, "nope.md"))).toEqual([]);
    expect(parseGapMatrix(write("# Gap Matrix\n\nNo table here.\n"))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/utils/gate-gen.test.ts -t "column-name resolution"`

Expected: FAIL. `GapMatrixHeaderError` is not exported (import error), and the
first three cases return 0 rows / the wrong gate.

- [ ] **Step 3: Implement name-based parsing**

In `src/utils/gate-gen.ts`, replace the block from `// ─── Gap Matrix types and parser (ADR-005 §8) ───` (line 313) through the end of `parseGapMatrix` (line 387) with:

```ts
// ─── Gap Matrix types and parser (ADR-005 §8) ────────────────────────────────

interface GapMatrixRow {
  ac: string; // e.g., "FR-001"
  criterion: string; // human-readable description
  testType: "unit" | "functional" | "integration" | "e2e" | "structural";
  testFile: string | null; // relative path or null if "—"
  testExists: boolean; // ✅ = true, ❌ = false
  gate: string | null; // e.g., "T001" or null if "—" / empty
}

/**
 * The canonical gap-matrix columns (contracts/gap-matrix.md).
 *
 * Matched by NAME, never by position: an authored matrix may legitimately carry
 * extra columns (`Phase` is common) in any order. Positional parsing is what
 * produced `2, 3-gate.sh` — a `Phase` value read as a gate id.
 */
const GAP_MATRIX_COLUMNS = [
  "AC",
  "Acceptance Criterion",
  "Test Type",
  "Test File",
  "Test Exists",
  "Gate",
] as const;

/** Thrown when a gap-matrix table exists but lacks a required column. Fatal by
 *  design — a silently mis-parsed matrix generates no gates and reports success. */
export class GapMatrixHeaderError extends Error {
  constructor(
    readonly header: string[],
    readonly missing: string[],
  ) {
    super(
      `unrecognized gap-matrix header — missing required column(s): ${missing.join(", ")}\n` +
        `    got:      | ${header.join(" | ")} |\n` +
        `    expected: | ${GAP_MATRIX_COLUMNS.join(" | ")} |  (extra columns are allowed, in any order)`,
    );
    this.name = "GapMatrixHeaderError";
  }
}

/** Split a markdown table row into cells, PRESERVING empty cells. Dropping them
 *  (the pre-028 behaviour) silently shifts every column to its left. */
function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/** A `|---|:--:|---|` separator row. */
function isSeparatorRow(trimmed: string): boolean {
  return /^\|[\s:|-]*\|?$/.test(trimmed) && trimmed.includes("-");
}

/**
 * parseGapMatrix — read and parse a gap-matrix.md file.
 *
 * Resolves the required columns by name from the header row, then reads every
 * data row at those indices. Rows whose width differs from the header belong to
 * a different table in the same document and are skipped.
 *
 * Returns [] when the file is absent or contains no gap-matrix table.
 * Throws GapMatrixHeaderError when a table is present but a required column is
 * missing — never returns a partial parse.
 */
export function parseGapMatrix(gapMatrixPath: string): GapMatrixRow[] {
  if (!fs.existsSync(gapMatrixPath)) {
    return [];
  }

  const lines = fs.readFileSync(gapMatrixPath, "utf-8").split("\n");

  // Find the table — look for the header row with "AC" column
  const headerIdx = lines.findIndex(
    (line) => line.includes("| AC") && line.includes("Test Type"),
  );
  if (headerIdx === -1) return [];

  const header = splitTableRow(lines[headerIdx]);

  const columnIndex = new Map<string, number>();
  const missing: string[] = [];
  for (const col of GAP_MATRIX_COLUMNS) {
    const i = header.findIndex((h) => h.toLowerCase() === col.toLowerCase());
    if (i === -1) missing.push(col);
    else columnIndex.set(col, i);
  }
  if (missing.length > 0) throw new GapMatrixHeaderError(header, missing);

  const at = (cells: string[], col: string): string =>
    cells[columnIndex.get(col) as number] ?? "";
  const orNull = (v: string): string | null =>
    v === "" || v === "—" || v === "-" ? null : v;

  const rows: GapMatrixRow[] = [];
  for (const line of lines.slice(headerIdx + 1)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    if (isSeparatorRow(trimmed)) continue;

    const cells = splitTableRow(line);
    // A row of a different width belongs to another table in this document.
    if (cells.length !== header.length) continue;
    // A repeated header row (authored matrices sometimes restate it per phase).
    if (cells.every((c, i) => c.toLowerCase() === header[i].toLowerCase()))
      continue;

    const testType = at(cells, "Test Type") as GapMatrixRow["testType"];
    if (
      !["unit", "functional", "integration", "e2e", "structural"].includes(
        testType,
      )
    ) {
      continue;
    }

    rows.push({
      ac: at(cells, "AC"),
      criterion: at(cells, "Acceptance Criterion"),
      testType,
      testFile: orNull(at(cells, "Test File")),
      testExists: at(cells, "Test Exists") === "✅",
      gate: orNull(at(cells, "Gate")),
    });
  }

  return rows;
}
```

> The `Test Type` whitelist stays strict in this task so the diff is reviewable
> on its own; Task 2 replaces that `if` with `normalizeTestType`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/gate-gen.test.ts`

Expected: PASS, including the four pre-existing `parseGapMatrix (TR-011)` tests.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/utils/gate-gen.ts src/utils/gate-gen.test.ts
git commit -m "$(cat <<'EOF'
fix(gate-gen): resolve gap-matrix columns by name, never by position

parseGapMatrix filtered empty cells out of every row before destructuring by
fixed index, so an empty Gate cell shifted every column left. Canonical 6-col
rows collapsed to 5 cells and tripped the `< 6` guard; 7-col rows carrying a
Phase column had Phase read as the gate id (`2, 3-gate.sh`) or as Test Type.

Now the required columns are resolved by name from the header once, cells are
split position-preserving, foreign-width and repeated-header rows are skipped,
and a header missing a required column throws GapMatrixHeaderError instead of
yielding a silent partial parse.

Measured on data-dashboard's six define worktrees: ~256 table rows previously
parsed to 4.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Accept compound `Test Type` values

Authored matrices use a richer vocabulary than the contract's enum — `unit + gate`,
`gate + integration`, `` `[integration]` ``, `unit + gate + integration`. In 010 only
14 of 45 aligned rows use a bare whitelisted type. Extract the first recognized
*behavioral* type; a row whose type names no behavioral test (e.g. bare `gate`) becomes
`structural`, which `generateDeterministicGates` already skips — audited, never silently
dropped.

**Files:**
- Modify: `src/utils/gate-gen.ts` (add `normalizeTestType`, use it in `parseGapMatrix`)
- Test: `src/utils/gate-gen.test.ts`

**Interfaces:**
- Consumes: `parseGapMatrix` and `GAP_MATRIX_COLUMNS` from Task 1.
- Produces: `export function normalizeTestType(raw: string): GapMatrixRow["testType"]`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("normalizeTestType (028 — compound authored vocabulary)", () => {
  it("takes the behavioral type out of a compound value", () => {
    expect(normalizeTestType("unit + gate")).toBe("unit");
    expect(normalizeTestType("gate + integration")).toBe("integration");
    expect(normalizeTestType("unit + gate + integration")).toBe("unit");
    expect(normalizeTestType("gate + unit")).toBe("unit");
  });

  it("strips markdown decoration", () => {
    expect(normalizeTestType("`[integration]`")).toBe("integration");
    expect(normalizeTestType("**unit**")).toBe("unit");
  });

  it("falls back to structural when no behavioral type is named", () => {
    expect(normalizeTestType("gate")).toBe("structural");
    expect(normalizeTestType("")).toBe("structural");
    expect(normalizeTestType("Test Type")).toBe("structural");
  });

  it("passes bare canonical values through", () => {
    for (const t of ["unit", "functional", "integration", "e2e", "structural"]) {
      expect(normalizeTestType(t)).toBe(t);
    }
  });
});

describe("parseGapMatrix — compound Test Type rows survive (028)", () => {
  it("keeps a `unit + gate` row as a unit row", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gap-matrix-tt-"));
    const p = path.join(tempDir, "gap-matrix.md");
    fs.writeFileSync(
      p,
      `| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-001 | compound | unit + gate | tests/a.test.js | ✅ | T001 |
| FR-002 | gate only | gate | tests/b.test.js | ✅ | T002 |
`,
    );

    const rows = parseGapMatrix(p);
    expect(rows).toHaveLength(2);
    expect(rows[0].testType).toBe("unit");
    expect(rows[1].testType).toBe("structural");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/gate-gen.test.ts -t "normalizeTestType"`

Expected: FAIL — `normalizeTestType` is not exported.

- [ ] **Step 3: Implement**

Add above `parseGapMatrix` in `src/utils/gate-gen.ts`:

```ts
const BEHAVIORAL_TEST_TYPES = [
  "unit",
  "functional",
  "integration",
  "e2e",
] as const;

/**
 * normalizeTestType — map an authored Test Type cell onto the canonical enum.
 *
 * Authored matrices use compound and decorated values (`unit + gate`,
 * `gate + integration`, `` `[integration]` ``). The first recognized behavioral
 * type wins. A cell naming no behavioral type (bare `gate`, empty, a restated
 * header) is `structural` — which generateDeterministicGates skips and counts,
 * rather than the row disappearing before it can be audited.
 */
export function normalizeTestType(raw: string): GapMatrixRow["testType"] {
  const tokens = raw
    .toLowerCase()
    .replace(/[`*[\]()]/g, "")
    .split(/[+,/]/)
    .map((t) => t.trim())
    .filter(Boolean);

  for (const token of tokens) {
    if ((BEHAVIORAL_TEST_TYPES as readonly string[]).includes(token)) {
      return token as GapMatrixRow["testType"];
    }
  }
  return "structural";
}
```

Then in `parseGapMatrix`, replace the strict whitelist block:

```ts
    const testType = at(cells, "Test Type") as GapMatrixRow["testType"];
    if (
      !["unit", "functional", "integration", "e2e", "structural"].includes(
        testType,
      )
    ) {
      continue;
    }
```

with:

```ts
    const testType = normalizeTestType(at(cells, "Test Type"));
```

and change the `rows.push({ ... testType, ... })` entry to stay `testType` (no change needed).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/gate-gen.test.ts`

Expected: PASS. Note the pre-existing test at `gate-gen.test.ts:237` ("should handle — (dash) values as null") passes a bare `structural`, which still normalizes to `structural`.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/utils/gate-gen.ts src/utils/gate-gen.test.ts
git commit -m "$(cat <<'EOF'
fix(gate-gen): accept compound Test Type values in the gap matrix

Authored matrices use `unit + gate`, `gate + integration`, `[integration]` —
in 010-reporting-email only 14 of 45 aligned rows carried a bare enum value, so
the strict whitelist dropped the rest. normalizeTestType takes the first
recognized behavioral type; a cell naming none (bare `gate`) becomes structural,
which gate generation already skips and counts.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Reject gate IDs that are not real task IDs

Even with correct column resolution, a resolved gate id must be a task id from
`tasks.json`. `${gateId}-gate.sh` with `gateId = "2, 3"` produced a file that
`lintAllGates` (which only matches `/^T\d+-gate\.sh$/`) never linted and no task
ever referenced.

**Files:**
- Modify: `src/utils/gate-gen.ts:401-479` (`generateDeterministicGates` — signature, task-id set, group loop) and `src/utils/gate-gen.ts:603-613` (`generateFilesystemGates` return shape)
- Test: `src/utils/gate-gen.test.ts`

**Interfaces:**
- Consumes: `parseGapMatrix` (Tasks 1-2).
- Produces:
  - `export interface GateGenResult { generated: number; skipped: number; invalidGateIds: string[] }`
  - `generateDeterministicGates(featureDir, gapMatrixPath, phases, profile?): GateGenResult`
  - `generateFilesystemGates(featureDir, phases): GateGenResult` (always `invalidGateIds: []`)

- [ ] **Step 1: Write the failing test**

```ts
describe("generateDeterministicGates — gate id must be a task id (028)", () => {
  it("skips a gate id that no task owns and reports it", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-id-"));
    const featureDir = path.join(tempDir, "specs", "009-x");
    fs.mkdirSync(featureDir, { recursive: true });
    const matrixPath = path.join(featureDir, "gap-matrix.md");
    fs.writeFileSync(
      matrixPath,
      `| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-001 | bogus gate id | unit | tests/a.test.js | ✅ | 2, 3 |
| FR-002 | real gate id | unit | tests/b.test.js | ✅ | T001 |
`,
    );

    const phases = [
      {
        id: "phase-01",
        tasks: [
          {
            id: "T001",
            title: "Task 1",
            description: "tests/b.test.js",
            status: "open" as const,
            gateScript: "gates/T001-gate.sh",
          },
        ],
      },
    ];

    const result = generateDeterministicGates(
      featureDir,
      matrixPath,
      // biome-ignore lint/suspicious/noExplicitAny: test fixture shape
      phases as any,
    );

    expect(result.invalidGateIds).toContain("2, 3");
    expect(fs.existsSync(path.join(featureDir, "gates", "2, 3-gate.sh"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(featureDir, "gates", "T001-gate.sh"))).toBe(
      true,
    );

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/gate-gen.test.ts -t "gate id must be a task id"`

Expected: FAIL — `result.invalidGateIds` is `undefined` and `2, 3-gate.sh` is created.

- [ ] **Step 3: Implement**

In `src/utils/gate-gen.ts`, add near `GAP_MATRIX_COLUMNS`:

```ts
/** Outcome of a gate-generation pass. `invalidGateIds` are gap-matrix Gate
 *  values that match no task id — reported so a mis-authored matrix is visible
 *  instead of yielding an orphan `<id>-gate.sh` no task ever runs. */
export interface GateGenResult {
  generated: number;
  skipped: number;
  invalidGateIds: string[];
}
```

Change `generateDeterministicGates`'s return type from
`{ generated: number; skipped: number }` to `GateGenResult`. Directly after
`const rows = parseGapMatrix(gapMatrixPath);` add:

```ts
  const validTaskIds = new Set<string>();
  for (const phase of phases) {
    for (const task of phase.tasks) validTaskIds.add(task.id);
  }
  const invalidGateIds = new Set<string>();
```

In the `for (const row of resolvedRows)` grouping loop, after the existing
`structural` skip, add:

```ts
    if (!validTaskIds.has(row.gate)) {
      invalidGateIds.add(row.gate);
      skipped++;
      continue;
    }
```

Change both `return { generated, skipped }` statements in that function to:

```ts
  return { generated, skipped, invalidGateIds: [...invalidGateIds] };
```

(There is an early `return { generated: 0, skipped: 0 }` for a missing gap
matrix — make it `return { generated: 0, skipped: 0, invalidGateIds: [] }`.)

In `generateFilesystemGates`, change the return type to `GateGenResult` and its
`return { generated, skipped }` to `return { generated, skipped, invalidGateIds: [] }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/gate-gen.test.ts`

Expected: PASS. Existing tests read `.generated` / `.skipped` only, so the added field is compatible.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/utils/gate-gen.ts src/utils/gate-gen.test.ts
git commit -m "$(cat <<'EOF'
fix(gate-gen): a gap-matrix Gate value must name a real task

`${gateId}-gate.sh` wrote whatever the Gate column held, so a mis-parsed matrix
produced `2, 3-gate.sh` — a file lintAllGates never matched (/^T\d+-gate\.sh$/)
and no task ever referenced. Gate ids are now validated against the task ids in
tasks.json; unmatched ids are skipped and returned as GateGenResult.invalidGateIds
so define can report them.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Stop emitting a gate runner that has nothing to run

`run-all-gates.sh` globs `T*-gate.sh`, and with an empty glob ends on
`[ $FAILED -eq 0 ]` with `TOTAL=0, FAILED=0` → **exit 0**. Verified empirically
against data-dashboard's runner: `0 passed, 0 failed / 0 total`, exit 0. Three
review PROMPTs execute it and read that as gate evidence.

Both halves matter: don't emit the runner when there are no gate files (every
consumer guards on `-f`, so absence degrades correctly — `review-code-cli/PROMPT.md:65`),
*and* make a runner that does exist fail when its glob comes up empty.

**Files:**
- Modify: `src/utils/gate-gen.ts:193-231` (`generateRunner`)
- Test: `src/utils/gate-gen.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `generateRunner(gatesDir: string): void` — unchanged signature, now conditional.

- [ ] **Step 1: Write the failing tests**

```ts
describe("generateRunner — no vacuous green (028)", () => {
  let gatesDir: string;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-runner-"));
    gatesDir = path.join(tempDir, "gates");
    fs.mkdirSync(gatesDir, { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const runnerPath = () => path.join(gatesDir, "run-all-gates.sh");

  it("does not emit a runner when there are no gate files", () => {
    generateRunner(gatesDir);
    expect(fs.existsSync(runnerPath())).toBe(false);
  });

  it("removes a stale runner when the gate files are gone", () => {
    fs.writeFileSync(runnerPath(), "#!/bin/bash\nexit 0\n", { mode: 0o755 });
    generateRunner(gatesDir);
    expect(fs.existsSync(runnerPath())).toBe(false);
  });

  it("emits a runner when at least one gate file exists", () => {
    fs.writeFileSync(
      path.join(gatesDir, "T001-gate.sh"),
      "#!/bin/bash\nexit 0\n",
      { mode: 0o755 },
    );
    generateRunner(gatesDir);
    expect(fs.existsSync(runnerPath())).toBe(true);
  });

  it("emits a runner that fails when its glob finds nothing", () => {
    fs.writeFileSync(
      path.join(gatesDir, "T001-gate.sh"),
      "#!/bin/bash\nexit 0\n",
      { mode: 0o755 },
    );
    generateRunner(gatesDir);

    // Simulate the state that produced the vacuous pass: runner present,
    // gate files gone. Stub the build pre-flight so only the glob is under test.
    fs.unlinkSync(path.join(gatesDir, "T001-gate.sh"));
    const body = fs
      .readFileSync(runnerPath(), "utf-8")
      .replace(/if pnpm build[^\n]*/, "if true; then");
    fs.writeFileSync(runnerPath(), body, { mode: 0o755 });

    const r = spawnSync("bash", [runnerPath()], { encoding: "utf-8" });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/no T\*-gate\.sh/);
  });
});
```

Add `import { spawnSync } from "node:child_process";` to the test file's imports.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/gate-gen.test.ts -t "no vacuous green"`

Expected: FAIL — the runner is written unconditionally and exits 0 on an empty glob.

- [ ] **Step 3: Implement**

Replace `generateRunner` in `src/utils/gate-gen.ts` with:

```ts
export function generateRunner(gatesDir: string): void {
  const runnerPath = path.join(gatesDir, "run-all-gates.sh");

  const gateFiles = fs.existsSync(gatesDir)
    ? fs.readdirSync(gatesDir).filter((f) => /^T\d+-gate\.sh$/.test(f))
    : [];

  // No convention gate files → no runner. A runner over an empty glob ends on
  // `[ $FAILED -eq 0 ]` with TOTAL=0 and exits 0, handing every consumer
  // (the review PROMPTs, a human running it by hand) a vacuous pass. Consumers
  // all guard on `-f`, so absence degrades correctly; a lie does not.
  if (gateFiles.length === 0) {
    if (fs.existsSync(runnerPath)) fs.unlinkSync(runnerPath);
    return;
  }

  fs.writeFileSync(
    runnerPath,
    `#!/bin/bash
# Hard Gate Runner — runs all T*-gate.sh scripts sequentially
set -e

# Pre-flight: TypeScript compilation must pass before individual gates
echo "▸ pnpm build (compile gate)..."
if pnpm build > /dev/null 2>&1; then
    echo "✅ PASS"
else
    echo "❌ FAIL — pnpm build failed. Fix TypeScript errors before shipping." >&2
    exit 1
fi

PASSED=0; FAILED=0; TOTAL=0
GATES=$(ls "$(dirname "$0")"/T*-gate.sh 2>/dev/null | sort)
echo "────────────────────────────────────────"
echo "  GWRK HARD GATE RUNNER"
echo "────────────────────────────────────────"
for gate in $GATES; do
    TOTAL=$((TOTAL + 1))
    echo -n "▸ $(basename "$gate")... "
    if "$gate" > /dev/null 2>&1; then
        echo "✅ PASS"; PASSED=$((PASSED + 1))
    else
        echo "❌ FAIL"; FAILED=$((FAILED + 1))
    fi
done
echo "────────────────────────────────────────"
echo "  $PASSED passed, $FAILED failed / $TOTAL total"
echo "────────────────────────────────────────"
if [ "$TOTAL" -eq 0 ]; then
    echo "❌ FAIL — no T*-gate.sh found next to this runner; refusing to report a pass over zero gates." >&2
    exit 1
fi
[ $FAILED -eq 0 ]
`,
    { mode: 0o755 },
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/gate-gen.test.ts`

Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/utils/gate-gen.ts src/utils/gate-gen.test.ts
git commit -m "$(cat <<'EOF'
fix(gate-gen): never emit a gate runner that passes over zero gates

run-all-gates.sh globs T*-gate.sh and, on an empty glob, ends on
`[ $FAILED -eq 0 ]` with TOTAL=0 — exit 0. All 12 data-dashboard features had a
runner and zero gate files, so gwrk-review-code/PROMPT.md:72 and the two
review-code PROMPTs have been reading a vacuous pass as gate evidence.

generateRunner now emits nothing (and removes a stale runner) when no
T*-gate.sh is present — consumers guard on `-f`, so absence degrades correctly
— and an emitted runner exits 1 if its glob ever comes up empty.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Make gate-generation failure fail the define run

`define-orchestrator.ts:428` catches everything from the gate block and prints
`⚠ gate generation failed: …`, then returns `{ success: true, exitCode: 0 }`. That
swallow is what would downgrade Task 1's `GapMatrixHeaderError` to a warning nobody
reads. Also surface `invalidGateIds` from Task 3.

**Files:**
- Modify: `src/engine/define-orchestrator.ts:411-430`
- Test: `src/utils/gate-gen.test.ts` (the orchestrator stage is not unit-testable in isolation; assert the contract it depends on)

**Interfaces:**
- Consumes: `GateGenResult` and `GapMatrixHeaderError` from Tasks 1 and 3.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

```ts
describe("GapMatrixHeaderError is fatal-shaped (028)", () => {
  it("is an Error carrying the offending header and missing columns", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gap-hdr-"));
    const p = path.join(tempDir, "gap-matrix.md");
    fs.writeFileSync(
      p,
      `| AC | Acceptance Criterion | Test Type | Test File | Test Exists |
|----|---------------------|-----------|-----------|-------------|
| FR-001 | no gate col | unit | tests/a.test.js | ✅ |
`,
    );

    let caught: unknown;
    try {
      parseGapMatrix(p);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(GapMatrixHeaderError);
    const err = caught as GapMatrixHeaderError;
    expect(err.missing).toEqual(["Gate"]);
    expect(err.header).toContain("Test Exists");
    expect(err.message).toContain("expected:");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails, then passes**

Run: `npx vitest run src/utils/gate-gen.test.ts -t "fatal-shaped"`

Expected: PASS already if Task 1 landed (`missing`/`header` are exposed there). If it
FAILS, Task 1's `GapMatrixHeaderError` is missing the public readonly fields — add them
before continuing.

- [ ] **Step 3: Stop swallowing the failure**

In `src/engine/define-orchestrator.ts`, replace the gate block at lines 411-430 with:

```ts
      // ── Deterministic gate generation ──
      try {
        const gapMatrixPath = path.join(featureDir, "gap-matrix.md");
        let gateResult: GateGenResult;

        if (fs.existsSync(gapMatrixPath)) {
          console.log("  ▸ generating deterministic gates from gap-matrix.md");
          gateResult = generateDeterministicGates(featureDir, gapMatrixPath, state.phases, profile);
        } else {
          console.log("  ▸ generating vitest gates from filesystem convention");
          gateResult = generateFilesystemGates(featureDir, state.phases);
        }

        const gatesDir = path.join(featureDir, "gates");
        if (fs.existsSync(gatesDir)) generateRunner(gatesDir);

        console.log(`  ✓ gates: ${gateResult.generated} generated, ${gateResult.skipped} skipped`);
        if (gateResult.invalidGateIds.length > 0) {
          console.warn(
            `  ⚠ gap-matrix Gate values matching no task id (no gate written): ${gateResult.invalidGateIds.join(", ")}`,
          );
        }
      } catch (gateError) {
        // Deliberately fatal. A mis-authored or mis-parsed gap matrix generates
        // ZERO gates; downgrading that to a warning is how a feature ships with
        // no executable gates while define reports success.
        const msg = gateError instanceof Error ? gateError.message : String(gateError);
        console.error(`  ✗ gate generation failed: ${msg}`);
        return { success: false, exitCode: 1, error: `gate generation failed: ${msg}` };
      }
```

Add `GateGenResult` to the existing `gate-gen.js` import block at the top of the file (`src/engine/define-orchestrator.ts:17-19`), as a type import alongside the three functions.

- [ ] **Step 4: Verify the build and full suite**

```bash
npm run build
npm run test:ci
```

Expected: build clean; suite green except the 3 known `server.test.ts` local-only failures.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/engine/define-orchestrator.ts src/utils/gate-gen.test.ts
git commit -m "$(cat <<'EOF'
fix(define): gate-generation failure fails the run instead of warning

The gate block caught everything and returned success, so a gap matrix that
generated zero gates looked identical to one that generated all of them —
`gates: 0 generated, 0 skipped`. It now returns a non-zero StageResult, and
Gate values matching no task id are reported by id.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Update the gap-matrix contract

The contract is the spec this parser implements. It currently declares a fixed
6-column schema and a `Test Type` enum the authored matrices don't follow.

**Files:**
- Modify: `specs/000-tdd-infrastructure/contracts/gap-matrix.md` (Schema, Column Definitions, Test Type Classification, Invariants)

**Interfaces:**
- Consumes: behavior from Tasks 1-4.
- Produces: no code.

- [ ] **Step 1: Update the Schema section**

Replace the `## Schema` fenced block and add a note beneath it:

```markdown
## Schema

```markdown
| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
```

**Columns are matched by name, not by position.** Extra columns (`Phase` is
common) may appear anywhere; column order may vary. All six named columns above
MUST be present — a table missing one is a hard error (`GapMatrixHeaderError`),
not a partial parse. Rows whose cell count differs from the header belong to a
different table in the same document and are ignored, so a document may carry
additional tables.
```

- [ ] **Step 2: Update the Test Type row of Column Definitions**

Replace the `Test Type` row:

```markdown
| Test Type | `enum` | `unit` \| `functional` \| `integration` \| `e2e` \| `structural`. Compound and decorated values are accepted (`unit + gate`, `gate + integration`, `` `[integration]` ``) — the first named behavioral type wins; a cell naming none (e.g. bare `gate`) is read as `structural` |
```

And the `Gate` row:

```markdown
| Gate | `string` | Task ID (`T###`) that this criterion gates, or `—`/empty if not yet mapped. A value matching no task ID in `tasks.json` is reported and generates no gate |
```

- [ ] **Step 3: Add the parser invariants**

Append to `## Invariants`:

```markdown
7. Columns are resolved by name; empty cells are preserved (never filtered), so
   an empty `Gate` cell cannot shift the other columns
8. A `Gate` value that matches no task ID in `tasks.json` generates no gate file
   and is reported by `define` as an unmatched gate id
9. `gates/run-all-gates.sh` is emitted only when at least one `T###-gate.sh`
   exists beside it, and exits non-zero if its glob is ever empty — it must
   never report a pass over zero gates
```

- [ ] **Step 4: Verify nothing references the old wording**

Run: `grep -rn "Test Type.*enum" specs/000-tdd-infrastructure/contracts/gap-matrix.md && npm run test:ci`

Expected: the updated row prints; suite green except the 3 known `server.test.ts` failures.

- [ ] **Step 5: Commit**

```bash
git add specs/000-tdd-infrastructure/contracts/gap-matrix.md
git commit -m "$(cat <<'EOF'
docs(contracts): gap-matrix columns are matched by name, not position

Documents what the parser now enforces: all six named columns required, extra
columns allowed in any order, compound Test Type accepted, Gate must name a real
task id, and the runner is never emitted over zero gates.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

- [ ] `npm run build` — clean
- [ ] `npm run test:ci` — green except the 3 known local-only `server.test.ts` failures
- [ ] `npm run lint` — clean
- [ ] Replay the real defect against the rebuilt `dist/`:

```bash
node -e '
const { parseGapMatrix } = require("./dist/utils/gate-gen.js");
const fs = require("fs");
for (const f of fs.readdirSync("/Users/dgonzalez/Projects/Data/.dd-define-wt")) {
  const p = `/Users/dgonzalez/Projects/Data/.dd-define-wt/${f}/specs/${f}/gap-matrix.md`;
  if (!fs.existsSync(p)) continue;
  try {
    const rows = parseGapMatrix(p);
    const ids = [...new Set(rows.filter(r => r.gate).map(r => r.gate))];
    console.log(`${f.padEnd(28)} parsed=${String(rows.length).padStart(3)}  gateIds=${JSON.stringify(ids)}`);
  } catch (e) { console.log(`${f.padEnd(28)} THROWS: ${e.message.split("\n")[0]}`); }
}'
```

Expected: every feature parses far more than 0 rows (previously 0, 0, 0, 4, 0, 0), and
no gate id is a phase number like `"3"` or `"2, 3"`. Record the actual numbers — they go
in the PR body and the data-dashboard handoff.

- [ ] Open the PR **against `develop`**.

## Self-Review

**Spec coverage** — every defect from the debugging pass maps to a task:
positional destructure + empty-cell filter → Task 1; `Test Type` vocabulary
mismatch → Task 2; `${gateId}-gate.sh` unvalidated → Task 3; vacuous runner →
Task 4; swallowed failure → Task 5; stale contract → Task 6.

**Out of scope, deliberately:** `gate-exec.ts` strategy order (a convention file
still shadows an inline `gateScript` — that is the documented design and the
reason data-dashboard must *delete* rather than rename its stray gate files);
retiring the gates/ channel; the runner's hardcoded `pnpm build` pre-flight;
`tasks-generate.ts`'s dead generator imports.

**Type consistency** — `GateGenResult` is introduced in Task 3 and consumed by
name in Task 5; `GapMatrixHeaderError` is introduced in Task 1 with the
`header`/`missing` readonly fields that Tasks 1 and 5 both assert;
`normalizeTestType` returns `GapMatrixRow["testType"]` everywhere.
