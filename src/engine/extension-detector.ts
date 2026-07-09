/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execSync } from "node:child_process";

export interface ExtensionInfo {
  id: string;
  name: string;
  command: string;
  detected: boolean;
  version?: string;
}

/**
 * Detects installed CLI extensions that gwrk can integrate with.
 */
export async function detectExtensions(): Promise<ExtensionInfo[]> {
  const extensions: ExtensionInfo[] = [
    {
      id: "obsidian",
      name: "Obsidian CLI",
      command: "obsidian",
      detected: false,
    },
    {
      id: "github",
      name: "GitHub CLI",
      command: "gh",
      detected: false,
    },
    {
      id: "slack",
      name: "Slack CLI",
      command: "slack",
      detected: false,
    },
    {
      id: "docker",
      name: "Docker CLI",
      command: "docker",
      detected: false,
    }
  ];

  for (const ext of extensions) {
    try {
      // Check if command exists in PATH
      const version = execSync(`${ext.command} --version`, { stdio: "pipe" })
        .toString()
        .trim();
      ext.detected = true;
      ext.version = version;
    } catch (error) {
      ext.detected = false;
    }
  }

  return extensions;
}
