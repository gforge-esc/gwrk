/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

const REGISTRY_URL = "https://github.com/gwrk-org/gwrk-plugins.git";
const REGISTRY_PATH = path.join(os.homedir(), ".gwrk", "registry");

/**
 * Registry Sync.
 * Clones or pulls the gwrk-plugins registry.
 */
export const syncRegistry = async (): Promise<void> => {
  const registryDir = REGISTRY_PATH;
  const parentDir = path.dirname(registryDir);

  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  if (fs.existsSync(registryDir)) {
    try {
      execSync("git pull", { cwd: registryDir, stdio: "ignore" });
    } catch (error) {
      // If pull fails, we might be offline or it's not a git repo, ignore for now
    }
  } else {
    try {
      execSync(`git clone ${REGISTRY_URL} ${registryDir}`, { stdio: "ignore" });
    } catch (error) {
      // If clone fails, ignore for now (maybe offline)
    }
  }
};
