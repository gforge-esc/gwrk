/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  type AgentRegistry,
  type RegistryConfigLayers,
  type RegistryValidationResult,
  validateAgentRegistry,
} from "../../domain/agent-config.js";
import { exitCli, logCliError } from "../cli/output-scope.js";

function readLayer(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

export function readRegistryConfigLayers(
  projectRoot = process.cwd(),
  homeDir = os.homedir(),
): RegistryConfigLayers {
  const configPath = path.join(projectRoot, ".gwrkrc.json");
  return {
    configPath,
    projectConfigRaw: readLayer(configPath),
    localConfigRaw: readLayer(path.join(projectRoot, ".gwrkrc.local.json")),
    globalConfigRaw: readLayer(path.join(homeDir, ".gwrk", "config.json")),
  };
}

export function tryLoadRegistry(
  projectRoot?: string,
  homeDir?: string,
): RegistryValidationResult {
  return validateAgentRegistry(readRegistryConfigLayers(projectRoot, homeDir));
}

export function loadRegistry(projectRoot?: string): AgentRegistry {
  const result = tryLoadRegistry(projectRoot);
  if (result.ok) return result.value;
  logCliError(result.error.message);
  return exitCli(1);
}
