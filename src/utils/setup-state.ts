import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

export const SetupStateSchema = z.object({
  completedAt: z.string().optional(),
  steps: z.object({
    tcc: z.boolean().default(false),
    ssh: z.boolean().default(false),
    gh: z.boolean().default(false),
    verification: z.boolean().default(false),
  }),
});

export type SetupState = z.infer<typeof SetupStateSchema>;

const SETUP_FILE = path.join(os.homedir(), ".gwrk", "setup.json");

export function loadSetupState(): SetupState | null {
  if (!fs.existsSync(SETUP_FILE)) {
    return null;
  }
  try {
    const data = JSON.parse(fs.readFileSync(SETUP_FILE, "utf-8"));
    return SetupStateSchema.parse(data);
  } catch (err) {
    return null;
  }
}

export function saveSetupState(state: SetupState): void {
  const dir = path.dirname(SETUP_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(SETUP_FILE, JSON.stringify(state, null, 2));
}

export function isSetupComplete(state: SetupState | null): boolean {
  if (!state) return false;
  return (
    state.steps.tcc &&
    state.steps.ssh &&
    state.steps.gh &&
    state.steps.verification
  );
}
