/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type {
  LedgerBackupManifest,
  LedgerBackupMetadata,
} from "../domain/ledger-backup.js";

export interface InstanceLockHandle {
  readonly pid: number;
  readonly lockPath: string;
  release(): void;
}

export interface InstanceLockPort {
  acquireInstanceLock(runtimeDir: string, pid: number): InstanceLockHandle;
}

export interface LedgerBackupRequest {
  readonly dbPath: string;
  readonly destination: string;
  readonly createdAt: string;
  readonly gwrkVersion: string;
  readonly metadata: Pick<LedgerBackupMetadata, "device">;
  collectRepositories(
    projects: readonly { id: string; path: string }[],
  ): LedgerBackupMetadata["repositories"];
}

export interface VerifiedLedgerBackup {
  readonly manifest: LedgerBackupManifest;
  readonly metadata: LedgerBackupMetadata;
}

export interface LedgerRestoreRequest {
  readonly source: string;
  readonly stateDirectory: string;
  readonly force: boolean;
}

export interface LedgerBackupPort {
  createBackup(input: LedgerBackupRequest): Promise<LedgerBackupManifest>;
  verifyBackup(directory: string): Promise<VerifiedLedgerBackup>;
  restoreBackup(input: LedgerRestoreRequest): Promise<VerifiedLedgerBackup>;
}
