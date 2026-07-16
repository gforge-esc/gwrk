/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const SetupStateSchema = z.object({
  completedAt: z.string().optional(),
  steps: z.object({
    tcc: z.boolean().default(false),
    ssh: z.boolean().default(false),
    gh: z.boolean().default(false),
    verification: z.boolean().default(false),
  }),
});

export type SetupState = z.infer<typeof SetupStateSchema>;

// GWRK_HOME overrides ~/.gwrk (matches config.ts) for testing and non-standard
// installations.
function setupFilePath(): string {
  const gwrkHome = process.env.GWRK_HOME || path.join(os.homedir(), ".gwrk");
  return path.join(gwrkHome, "setup.json");
}

export function loadSetupState(): SetupState | null {
  const setupFile = setupFilePath();
  if (!fs.existsSync(setupFile)) {
    return null;
  }
  try {
    const data = JSON.parse(fs.readFileSync(setupFile, "utf-8"));
    return SetupStateSchema.parse(data);
  } catch (err) {
    return null;
  }
}

export function saveSetupState(state: SetupState): void {
  const setupFile = setupFilePath();
  const dir = path.dirname(setupFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(setupFile, JSON.stringify(state, null, 2));
}

/**
 * Setup is complete once `gwrk init` has run to completion (`verification`).
 * The tcc/ssh/gh flags are recorded as diagnostics — a missing SSH key or gh
 * auth surfaces as a real error at git-push / PR time, not as an unsatisfiable
 * pre-flight block. This keeps "Run gwrk init first" a truthful instruction.
 */
export function isSetupComplete(state: SetupState | null): boolean {
  if (!state) return false;
  return state.steps.verification;
}
