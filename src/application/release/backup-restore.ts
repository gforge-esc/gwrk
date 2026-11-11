/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type {
  InstanceLockPort,
  LedgerBackupPort,
  LedgerRestoreRequest,
  VerifiedLedgerBackup,
} from "../../ports/release-ops-port.js";

export async function restoreOfflineLedger(
  backup: LedgerBackupPort,
  instances: InstanceLockPort,
  request: LedgerRestoreRequest & { runtimeDirectory: string; pid: number },
): Promise<VerifiedLedgerBackup> {
  const lock = instances.acquireInstanceLock(
    request.runtimeDirectory,
    request.pid,
  );
  try {
    return await backup.restoreBackup(request);
  } finally {
    lock.release();
  }
}
