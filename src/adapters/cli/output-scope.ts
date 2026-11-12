/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { AsyncLocalStorage } from "node:async_hooks";
import { formatWithOptions } from "node:util";
import { processForAgent } from "../../utils/agent-layer.js";

export interface CliOutputScope {
  agentMode: boolean;
  stdout?: (chunk: string) => void;
  stderr?: (chunk: string) => void;
  exitCode?: number;
}

const output = new AsyncLocalStorage<CliOutputScope>();

export function runWithOutputScope<T>(scope: CliOutputScope, run: () => T): T {
  return output.run(scope, run);
}

export function getOutputScope(): CliOutputScope | undefined {
  return output.getStore();
}

export function writeScopedStdout(chunk: string): boolean {
  const scope = getOutputScope();
  const text = scope?.agentMode ? processForAgent(chunk) : chunk;
  if (!scope?.stdout) return process.stdout.write(text);
  scope.stdout(text);
  return true;
}

export function writeScopedStderr(chunk: string): boolean {
  const scope = getOutputScope();
  if (!scope?.stderr) return process.stderr.write(chunk);
  scope.stderr(chunk);
  return true;
}

export function logCliOutput(...args: unknown[]): void {
  const scope = getOutputScope();
  if (!scope?.agentMode && !scope?.stdout) {
    console.log(...args);
    return;
  }
  writeScopedStdout(
    `${formatWithOptions({ colors: process.stdout.isTTY === true }, ...args)}\n`,
  );
}

export function logCliError(...args: unknown[]): void {
  if (!getOutputScope()?.stderr) {
    console.error(...args);
    return;
  }
  writeScopedStderr(
    `${formatWithOptions({ colors: process.stderr.isTTY === true }, ...args)}\n`,
  );
}

export function warnCli(...args: unknown[]): void {
  if (!getOutputScope()?.stderr) {
    console.warn(...args);
    return;
  }
  writeScopedStderr(
    `${formatWithOptions({ colors: process.stderr.isTTY === true }, ...args)}\n`,
  );
}

export function getCliExitCode(): number {
  return getOutputScope()?.exitCode ?? Number(process.exitCode ?? 0);
}

export function setCliExitCode(code: number): void {
  const scope = getOutputScope();
  if (scope?.exitCode !== undefined) {
    scope.exitCode = code;
  } else {
    process.exitCode = code;
  }
}

export class CliExit extends Error {
  constructor(public readonly exitCode: number) {
    super();
  }
}

export function exitCli(code: number): never {
  if (getOutputScope()?.exitCode !== undefined) {
    throw new CliExit(code);
  }
  return process.exit(code);
}
