/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { vi } from "vitest";

const execFileAsync = promisify(execFile);
const gitTimeoutMs = 10_000;
const identity = "Pulse Fixture <pulse-fixture@example.test>";

interface FixtureCommit {
  branch: "main" | "feature/draft";
  timestamp: string;
  message: string;
  files: Record<string, string>;
  parentMark?: number;
}

const branchHistory: FixtureCommit[] = [
  {
    branch: "main",
    timestamp: "2026-01-06T10:00:00Z",
    message: "Add file1",
    files: { "file1.ts": "export const a = 1;\nexport const b = 2;\n" },
  },
  {
    branch: "main",
    timestamp: "2026-01-13T10:00:00Z",
    message: "Add file2",
    files: {
      "file2.ts":
        "export const c = 3;\nexport const d = 4;\nexport const e = 5;\n",
    },
  },
  {
    branch: "main",
    timestamp: "2026-01-20T10:00:00Z",
    message: "Add file3 and update file1",
    files: {
      "file1.ts": "export const a = 10;\n",
      "file3.ts": "export const f = 6;\n",
    },
  },
  {
    branch: "feature/draft",
    timestamp: "2026-01-21T10:00:00Z",
    message: "Add draft",
    files: {
      "draft.ts": "export const draft = 1;\nexport const draft2 = 2;\n",
    },
    parentMark: 3,
  },
];

function importCommit(commit: FixtureCommit, index: number): string {
  const timestamp = Date.parse(commit.timestamp) / 1000;
  const lines = [
    `commit refs/heads/${commit.branch}`,
    `mark :${index + 1}`,
    `author ${identity} ${timestamp} +0000`,
    `committer ${identity} ${timestamp} +0000`,
    `data ${Buffer.byteLength(commit.message)}`,
    commit.message,
  ];
  if (commit.parentMark !== undefined) lines.push(`from :${commit.parentMark}`);
  for (const [filePath, content] of Object.entries(commit.files)) {
    lines.push(
      `M 100644 inline ${filePath}`,
      `data ${Buffer.byteLength(content)}`,
      content,
    );
  }
  return `${lines.join("\n")}\n\n`;
}

export function stubPulseGitEnv(env: NodeJS.ProcessEnv) {
  for (const name of Object.keys(process.env)) {
    if (!(name in env)) vi.stubEnv(name, undefined);
  }
  for (const [name, value] of Object.entries(env)) {
    vi.stubEnv(name, value);
  }
}

export async function createPulseGitFixture(history: "branches" | "scale") {
  const repoDir = await mkdtemp(path.join(tmpdir(), "pulse git-"));
  const cleanup = () => rm(repoDir, { recursive: true, force: true });
  const globalConfig = path.join(repoDir, "global.gitconfig");
  const globalAttributes = path.join(repoDir, "global.gitattributes");
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    TMP: process.env.TMP,
    TEMP: process.env.TEMP,
    HOME: repoDir,
    LC_ALL: "C",
    TZ: "UTC",
    EDITOR: "true",
    GIT_EDITOR: "true",
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.attributesFile",
    GIT_CONFIG_VALUE_0: globalAttributes,
    GIT_TERMINAL_PROMPT: "0",
  };
  const options = {
    cwd: repoDir,
    timeout: gitTimeoutMs,
    killSignal: "SIGKILL" as const,
    env,
  };

  try {
    await writeFile(globalConfig, "");
    await writeFile(globalAttributes, "");
    await execFileAsync(
      "git",
      ["init", "--initial-branch=main", "--template=", "--quiet"],
      options,
    );
    const commits =
      history === "branches"
        ? branchHistory
        : Array.from(
            { length: 100 },
            (_, index): FixtureCommit => ({
              branch: "main",
              timestamp: new Date(
                Date.UTC(2026, 0, 6, 10, index),
              ).toISOString(),
              message: `Add file ${index + 1}`,
              files: {
                [`file${index + 1}.ts`]: `export const value = ${index + 1};\n`,
              },
            }),
          );

    const gitImport = execFileAsync(
      "git",
      ["-c", "commit.gpgSign=false", "fast-import", "--quiet", "--done"],
      options,
    );
    const input = `${commits.map(importCommit).join("")}done\n`;
    const [importResult, inputResult] = await Promise.allSettled([
      gitImport,
      pipeline(Readable.from([input]), gitImport.child.stdin!),
    ]);
    if (importResult.status === "rejected") throw importResult.reason;
    if (inputResult.status === "rejected") throw inputResult.reason;
    return { repoDir, env, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
