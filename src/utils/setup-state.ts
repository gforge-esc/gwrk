import path from "node:path";
import os from "node:os";
import fs from "node:fs";

export interface SetupState {
  completedAt: string;
  steps: {
    tcc: boolean;
    ssh: boolean;
    gh: boolean;
    verification: boolean;
  };
}

export function loadSetupState(): SetupState | null {
  throw new Error("Not implemented");
}

export function saveSetupState(state: SetupState): void {
  throw new Error("Not implemented");
}
