/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import type { ProjectProfile } from "../engine/prompt-conditioner.js";

/**
 * Verbs that count as a real (functional) test invocation. gate-gen's
 * hollow-gate allowlist consumes this so a legitimate pytest/go/node:test/make
 * gate isn't flagged hollow on a non-vitest project. (ADR-005 §11)
 */
export const TEST_INVOCATION_VERBS = [
  "vitest",
  "jest",
  "pytest",
  "cargo test",
  "go test",
  "node --test",
  "make ",
] as const;

/** Infer the test harness from the project's language when none is declared. */
function inferHarness(profile: ProjectProfile): string {
  const lang =
    profile.stack?.language?.toLowerCase() ||
    profile.stack?.languages?.[0]?.toLowerCase();
  if (lang === "python") return "pytest";
  if (lang === "rust") return "cargo-test";
  if (lang === "go") return "go-test";
  return "vitest"; // javascript / typescript / unknown
}

/** Apply file args to a free-form command: substitute `{files}` if present, else append. */
function applyFiles(command: string, files: string[]): string {
  if (command.includes("{files}")) {
    return command.replace(/\{files\}/g, files.join(" ")).trim();
  }
  return files.length > 0 ? `${command} ${files.join(" ")}` : command;
}

/**
 * Maps a profile to its test invocation command. Returns `null` when the project
 * declares no test toolchain (`toolchain.test === null`) — the caller skips the
 * test gate (ADR-005 §11, 004 FR-023). A free-form `toolchain.testCommand` (e.g.
 * `make test:auth`, `node --test`) wins over the harness enum.
 */
export function getTestCommand(
  profile: ProjectProfile,
  files: string[],
  grepPattern?: string,
): string | null {
  const tc = profile.toolchain;
  if (tc?.test === null) return null; // explicit opt-out → skip
  if (tc?.testCommand) return applyFiles(tc.testCommand, files); // free-form wins

  const harness = tc?.test ?? inferHarness(profile);

  switch (harness) {
    case "vitest":
      return grepPattern
        ? `pnpm vitest run ${files.join(" ")} -t "${grepPattern}" --reporter=verbose`
        : `pnpm vitest run ${files.join(" ")} --reporter=verbose`;

    case "jest":
      return grepPattern
        ? `npx jest ${files.join(" ")} -t "${grepPattern}"`
        : `npx jest ${files.join(" ")}`;

    case "pytest":
      return grepPattern
        ? `pytest ${files.join(" ")} -k "${grepPattern}" -v`
        : `pytest ${files.join(" ")} -v`;

    case "cargo-test":
      // Cargo takes test names, not files.
      return grepPattern ? `cargo test "${grepPattern}"` : `cargo test`;

    case "go-test":
      return grepPattern
        ? `go test ${files.join(" ")} -run "${grepPattern}" -v`
        : `go test ${files.join(" ")} -v`;

    case "node-test":
      // node --test has no simple grep flag; run the mapped files.
      return `node --test ${files.join(" ")}`.trim();

    default:
      return grepPattern
        ? `pnpm vitest run ${files.join(" ")} -t "${grepPattern}" --reporter=verbose`
        : `pnpm vitest run ${files.join(" ")} --reporter=verbose`;
  }
}

/**
 * Maps a profile to its build command, or `null` to skip the build gate
 * (ADR-005 §11, 004 FR-022). `toolchain.build === null` skips explicitly; a string
 * is used verbatim; otherwise the build is inferred from the filesystem.
 */
export function getBuildCommand(
  profile: ProjectProfile,
  cwd: string,
): string | null {
  const tc = profile.toolchain;
  if (tc && "build" in tc) {
    if (tc.build === null) return null; // explicit skip
    if (typeof tc.build === "string" && tc.build.length > 0) return tc.build;
  }

  // Inference (relocated from ship-orchestrator's private resolveBuildCommand).
  const pkgPath = path.join(cwd, "package.json");
  if (fs.existsSync(pkgPath)) {
    // A Node project: decide from package.json and commit to it — do not fall
    // through to cargo/go (matches the prior resolveBuildCommand semantics).
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg?.scripts?.build) {
        if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm build";
        if (fs.existsSync(path.join(cwd, "yarn.lock"))) return "yarn build";
        return "npm run build";
      }
    } catch {
      // unparseable package.json
    }
    return null; // Node project with no usable build script → skip the build gate
  }
  if (fs.existsSync(path.join(cwd, "Cargo.toml"))) return "cargo build";
  if (fs.existsSync(path.join(cwd, "go.mod"))) return "go build ./...";
  return null;
}

/**
 * Maps a primary toolchain to its lint command
 */
export function getLintCommand(profile: ProjectProfile, files: string[]): string | null {
  if (files.length === 0) return null;

  const primary = profile.toolchain?.primary;

  // If not specified, try to infer from language
  const lang = profile.stack?.language?.toLowerCase() || profile.stack?.languages?.[0]?.toLowerCase();

  const tool = primary || (lang === "python" ? "ruff" : lang === "go" ? "golangci-lint" : lang === "rust" ? "cargo" : "biome");

  switch (tool) {
    case "biome":
      return `pnpm biome check ${files.join(" ")} --no-errors-on-unmatched`;
    case "eslint":
      return `npx eslint ${files.join(" ")}`;
    case "ruff":
      return `ruff check ${files.join(" ")}`;
    case "cargo":
      return `cargo clippy`;
    case "golangci-lint":
      return `golangci-lint run ${files.join(" ")}`;
    default:
      return null; // Opt out if unknown
  }
}

/**
 * Maps a profile to its expected test file extension. A declared
 * `toolchain.testExtension` wins; otherwise inferred from the language, with
 * JavaScript first-class (ADR-005 §11).
 */
export function getTestExtension(profile: ProjectProfile): string {
  if (profile.toolchain?.testExtension) return profile.toolchain.testExtension;

  const lang =
    profile.stack?.language?.toLowerCase() ||
    profile.stack?.languages?.[0]?.toLowerCase();

  if (lang === "python") return ".py"; // usually test_*.py, handled by heuristic
  if (lang === "go") return "_test.go";
  if (lang === "rust") return ".rs"; // tests inline or in tests/
  if (lang === "javascript") return ".test.js";
  if (lang === "typescript") return ".test.ts";
  return ".test.ts"; // default fallback
}

/**
 * Maps a profile to its expected source file extension. A declared
 * `toolchain.sourceExtension` wins; otherwise inferred from the language.
 */
export function getSourceExtension(profile: ProjectProfile): string {
  if (profile.toolchain?.sourceExtension) return profile.toolchain.sourceExtension;

  const lang =
    profile.stack?.language?.toLowerCase() ||
    profile.stack?.languages?.[0]?.toLowerCase();

  if (lang === "python") return ".py";
  if (lang === "go") return ".go";
  if (lang === "rust") return ".rs";
  if (lang === "javascript") return ".js";
  return ".ts"; // default fallback
}
