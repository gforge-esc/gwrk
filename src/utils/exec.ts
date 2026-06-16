/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFile, execFileSync, spawn } from "node:child_process";
import type { StdioOptions } from "node:child_process";

interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: StdioOptions;
  input?: string;
}

/**
 * Run a command with streaming output (stdio: inherit by default).
 * Returns a promise that resolves on success or rejects with exit code.
 */
export function run(
  command: string,
  args: string[],
  opts?: RunOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let stdio = opts?.stdio ?? "inherit";
    if (opts?.input && stdio === "inherit") {
      stdio = ["pipe", "inherit", "inherit"];
    }

    const child = spawn(command, args, {
      cwd: opts?.cwd,
      env: opts?.env ?? process.env,
      stdio,
    });

    if (opts?.input && child.stdin) {
      child.stdin.write(opts.input);
      child.stdin.end();
    }

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        const err = new Error(`Process exited with code ${code}`) as Error & {
          exitCode: number;
        };
        err.exitCode = code ?? 1;
        reject(err);
      }
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function execCommand(
  command: string,
  args: string[],
  stdin?: string,
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = execFile(
      command,
      args,
      {
        encoding: "utf-8",
        cwd: opts?.cwd,
        env: opts?.env ?? process.env,
      },
      (error, stdout, stderr) => {
        if (error) {
          const err = error as { code?: string; status?: number };
          if (err.code === "ENOENT") {
            resolve({
              exitCode: 127,
              stdout: "",
              stderr: `Command not found: ${command}`,
            });
            return;
          }

          resolve({
            exitCode:
              typeof err.code === "number" ? err.code : (err.status ?? 1),
            stdout: stdout.toString(),
            stderr: stderr.toString(),
          });
        } else {
          resolve({
            exitCode: 0,
            stdout: stdout.toString(),
            stderr: stderr.toString(),
          });
        }
      },
    );

    if (stdin && child.stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}

