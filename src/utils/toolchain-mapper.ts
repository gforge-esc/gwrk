/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { ProjectProfile } from "../engine/prompt-conditioner.js";

/**
 * Maps a test harness string to its invocation command
 */
export function getTestCommand(profile: ProjectProfile, files: string[], grepPattern?: string): string {
  const testHarness = profile.toolchain?.test || "vitest";

  switch (testHarness) {
    case "vitest":
      if (grepPattern) {
        return `pnpm vitest run ${files.join(" ")} -t "${grepPattern}" --reporter=verbose`;
      }
      return `pnpm vitest run ${files.join(" ")} --reporter=verbose`;

    case "jest":
      if (grepPattern) {
        return `npx jest ${files.join(" ")} -t "${grepPattern}"`;
      }
      return `npx jest ${files.join(" ")}`;

    case "pytest":
      if (grepPattern) {
        return `pytest ${files.join(" ")} -k "${grepPattern}" -v`;
      }
      return `pytest ${files.join(" ")} -v`;

    case "cargo-test":
      if (grepPattern) {
        // Cargo doesn't take files, it takes test names. 
        // For simplicity, we just run the grep pattern
        return `cargo test "${grepPattern}"`;
      }
      return `cargo test`;

    case "go-test":
      if (grepPattern) {
        return `go test ${files.join(" ")} -run "${grepPattern}" -v`;
      }
      return `go test ${files.join(" ")} -v`;

    default:
      // Fallback
      if (grepPattern) {
        return `pnpm vitest run ${files.join(" ")} -t "${grepPattern}" --reporter=verbose`;
      }
      return `pnpm vitest run ${files.join(" ")} --reporter=verbose`;
  }
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
 * Maps a profile to its expected test file extension
 */
export function getTestExtension(profile: ProjectProfile): string {
  const lang = profile.stack?.language?.toLowerCase() || profile.stack?.languages?.[0]?.toLowerCase();
  
  if (lang === "python") {
    return ".py"; // In Python, it's usually test_*.py, handled by heuristic
  } else if (lang === "go") {
    return "_test.go";
  } else if (lang === "rust") {
    return ".rs"; // Tests are inline or in tests/
  }
  
  return ".test.ts"; // Default fallback
}

/**
 * Maps a profile to its expected source file extension
 */
export function getSourceExtension(profile: ProjectProfile): string {
  const lang = profile.stack?.language?.toLowerCase() || profile.stack?.languages?.[0]?.toLowerCase();
  
  if (lang === "python") {
    return ".py";
  } else if (lang === "go") {
    return ".go";
  } else if (lang === "rust") {
    return ".rs";
  }
  
  return ".ts"; // Default fallback
}
