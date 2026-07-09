/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Command } from "commander";

/**
 * CommandOutput interface for abstracting stdout/stderr writes.
 * Supports text (default) and JSON formats.
 * Implements FR-002, TC-006 per output.md contract.
 */
interface CommandOutput {
  /** Whether output is JSON format */
  readonly isJson: boolean;
  /** Write data to stdout */
  write(data: string | object): void;
  /** Write info message to stderr */
  info(msg: string): void;
}

/**
 * Resolve format from the root program's --format option.
 * Commands call this once — never touch globalOpts.format directly.
 */
export function resolveFormat(command: Command): CommandOutput {
  let root = command;
  while (root.parent) root = root.parent;
  return createOutput(root.opts().format);
}

/**
 * Factory to create a CommandOutput instance based on the desired format.
 *
 * @param format - undefined (text output) or 'json'
 * @throws Error if format is not supported.
 */
export function createOutput(format?: string): CommandOutput {
  if (format === "json") {
    return {
      isJson: true,
      write(data: string | object): void {
        const output =
          typeof data === "string"
            ? JSON.stringify(data)
            : JSON.stringify(data, null, 2);
        process.stdout.write(`${output}\n`);
      },
      info(msg: string): void {
        process.stderr.write(`${msg}\n`);
      },
    };
  }

  if (format && format !== "json") {
    throw new Error(`Unknown format: ${format}. Supported: json`);
  }

  return {
    isJson: false,
    write(data: string | object): void {
      const output = typeof data === "string" ? data : String(data);
      process.stdout.write(output);
    },
    info(msg: string): void {
      process.stderr.write(`${msg}\n`);
    },
  };
}

/**
 * Utility to read the entire stdin into a string.
 */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString();
}
