/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import type { ProjectProfile } from "./types.js";

export const TEST_INVOCATION_VERBS = [
  "vitest",
  "jest",
  "pytest",
  "cargo test",
  "go test",
  "node --test",
  "make ",
] as const;

function inferHarness(profile: ProjectProfile): string {
  const lang =
    profile.stack?.language?.toLowerCase() ||
    profile.stack?.languages?.[0]?.toLowerCase();
  if (lang === "python") return "pytest";
  if (lang === "rust") return "cargo-test";
  if (lang === "go") return "go-test";
  return "vitest";
}

function applyFiles(command: string, files: string[]): string {
  if (command.includes("{files}")) {
    return command.replace(/\{files\}/g, files.join(" ")).trim();
  }
  return files.length > 0 ? `${command} ${files.join(" ")}` : command;
}

export function getTestCommand(
  profile: ProjectProfile,
  files: string[],
  grepPattern?: string,
): string | null {
  const tc = profile.toolchain;
  if (tc?.test === null) return null;
  if (tc?.testCommand) return applyFiles(tc.testCommand, files);

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
      return grepPattern ? `cargo test "${grepPattern}"` : "cargo test";

    case "go-test":
      return grepPattern
        ? `go test ${files.join(" ")} -run "${grepPattern}" -v`
        : `go test ${files.join(" ")} -v`;

    case "node-test":
      return `node --test ${files.join(" ")}`.trim();

    default:
      return grepPattern
        ? `pnpm vitest run ${files.join(" ")} -t "${grepPattern}" --reporter=verbose`
        : `pnpm vitest run ${files.join(" ")} --reporter=verbose`;
  }
}

export function getBuildCommand(
  profile: ProjectProfile,
  cwd: string,
): string | null {
  const tc = profile.toolchain;
  if (tc && "build" in tc) {
    if (tc.build === null) return null;
    if (typeof tc.build === "string" && tc.build.length > 0) return tc.build;
  }

  const pkgPath = path.join(cwd, "package.json");
  if (fs.existsSync(pkgPath)) {
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
    return null;
  }
  if (fs.existsSync(path.join(cwd, "Cargo.toml"))) return "cargo build";
  if (fs.existsSync(path.join(cwd, "go.mod"))) return "go build ./...";
  return null;
}

export function getLintCommand(
  profile: ProjectProfile,
  files: string[],
): string | null {
  if (files.length === 0) return null;

  const primary = profile.toolchain?.primary;
  const lang =
    profile.stack?.language?.toLowerCase() ||
    profile.stack?.languages?.[0]?.toLowerCase();

  const tool =
    primary ||
    (lang === "python"
      ? "ruff"
      : lang === "go"
        ? "golangci-lint"
        : lang === "rust"
          ? "cargo"
          : "biome");

  switch (tool) {
    case "biome":
      return `pnpm biome check ${files.join(" ")} --no-errors-on-unmatched`;
    case "eslint":
      return `npx eslint ${files.join(" ")}`;
    case "ruff":
      return `ruff check ${files.join(" ")}`;
    case "cargo":
    case "clippy":
      return "cargo clippy";
    case "golangci-lint":
      return `golangci-lint run ${files.join(" ")}`;
    default:
      return null;
  }
}

export function getTestExtension(profile: ProjectProfile): string {
  if (profile.toolchain?.testExtension) return profile.toolchain.testExtension;

  const lang =
    profile.stack?.language?.toLowerCase() ||
    profile.stack?.languages?.[0]?.toLowerCase();

  if (lang === "python") return ".py";
  if (lang === "go") return "_test.go";
  if (lang === "rust") return ".rs";
  if (lang === "javascript") return ".test.js";
  if (lang === "typescript") return ".test.ts";
  return ".test.ts";
}

export function getSourceExtension(profile: ProjectProfile): string {
  if (profile.toolchain?.sourceExtension)
    return profile.toolchain.sourceExtension;

  const lang =
    profile.stack?.language?.toLowerCase() ||
    profile.stack?.languages?.[0]?.toLowerCase();

  if (lang === "python") return ".py";
  if (lang === "go") return ".go";
  if (lang === "rust") return ".rs";
  if (lang === "javascript") return ".js";
  return ".ts";
}
