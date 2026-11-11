/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { isDeepStrictEqual } from "node:util";
import Database from "better-sqlite3";
import {
  LedgerBackupManifestSchema,
  type LedgerBackupMetadata,
  LedgerBackupMetadataSchema,
  type LedgerSummary,
  PENDING_LEDGER_RESTORE,
} from "../../domain/ledger-backup.js";
import type { AppliedMigration } from "../../domain/release-packaging.js";
import {
  type LedgerBackupPort,
  type LedgerBackupRequest,
  PendingLedgerRestoreError,
  type VerifiedLedgerBackup,
} from "../../ports/release-ops-port.js";
import { sha256 } from "../release/inventory.js";
import { readRepositoryEvidence } from "../release/repository-evidence.js";

const DB_FILE = "gwrk.db";
const METADATA_FILE = "repo-metadata.json";
const MANIFEST_FILE = "backup-manifest.json";
const DEVICE_FILE = "device.json";
const RESTORE_TRANSACTION_FILE = "restore-transaction.json";

async function syncPath(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function readAppliedMigrations(dbPath: string): AppliedMigration[] {
  return readLedger(dbPath, (db) => {
    const hasDigest = db
      .prepare(
        "SELECT 1 FROM pragma_table_info('_migrations') WHERE name = 'sha256'",
      )
      .get();
    return db
      .prepare(
        hasDigest
          ? "SELECT name, sha256 FROM _migrations ORDER BY name"
          : "SELECT name, NULL AS sha256 FROM _migrations ORDER BY name",
      )
      .all() as AppliedMigration[];
  });
}

function appliedMigrations(db: Database.Database): string[] {
  return db
    .prepare("SELECT name FROM _migrations ORDER BY name")
    .pluck()
    .all() as string[];
}

type BackupProject = { id: string; path: string };

function projectRows(db: Database.Database): BackupProject[] {
  return db
    .prepare("SELECT * FROM projects ORDER BY id")
    .all() as BackupProject[];
}

function readLedger<T>(dbPath: string, read: (db: Database.Database) => T): T {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return db.transaction(() => read(db))();
  } finally {
    db.close();
  }
}

function summarizeLedger(
  db: Database.Database,
  metadata: LedgerBackupMetadata,
): LedgerSummary {
  if (db.pragma("integrity_check", { simple: true }) !== "ok") {
    throw new Error("Ledger integrity check failed.");
  }
  const foreignKeys = db.pragma("foreign_key_check") as unknown[];
  if (foreignKeys.length > 0)
    throw new Error("Ledger foreign key check failed.");

  if (!isDeepStrictEqual(projectRows(db), metadata.projects)) {
    throw new Error("Backup project metadata does not match the ledger.");
  }
  const projectIds = metadata.projects.map(({ id }) => id);
  const projectPaths = new Map(
    metadata.projects.map(({ id, path }) => [id, path]),
  );
  const repoIds = new Set(
    metadata.repositories.map(({ projectId }) => projectId),
  );
  if (
    repoIds.size !== metadata.repositories.length ||
    [...repoIds].some((id) => !projectPaths.has(id))
  ) {
    throw new Error(
      "Repository metadata has duplicate or unknown project IDs.",
    );
  }
  for (const { projectId, root } of metadata.repositories) {
    const path = projectPaths.get(projectId);
    if (typeof path !== "string" || root !== resolve(path)) {
      throw new Error(
        `Repository metadata root does not match the ledger for ${projectId}.`,
      );
    }
  }

  return {
    migrations: appliedMigrations(db),
    projectIds,
    completedRunIds: db
      .prepare("SELECT id FROM runs WHERE finished_at IS NOT NULL ORDER BY id")
      .pluck()
      .all() as number[],
    compressionCount: db
      .prepare("SELECT count(*) FROM compression")
      .pluck()
      .get() as number,
    historyCount: db
      .prepare("SELECT count(*) FROM history")
      .pluck()
      .get() as number,
    enrolledRepoDigests: Object.fromEntries(
      metadata.repositories.map((repository) => [
        repository.projectId,
        createHash("sha256").update(JSON.stringify(repository)).digest("hex"),
      ]),
    ),
  };
}

export const createLedgerBackup: LedgerBackupPort["createBackup"] = async (
  input,
) => {
  const absolute = resolve(input.dbPath);
  const state = await realpath(dirname(absolute));
  return withMaintenanceLock(state, async () => {
    const pending = join(state, PENDING_LEDGER_RESTORE);
    if (await exists(pending)) throw new PendingLedgerRestoreError(pending);

    const dbPath = await realpath(join(state, basename(absolute)));
    if (dirname(dbPath) !== state) {
      throw new Error(
        `Ledger path must resolve within its state directory: ${absolute}`,
      );
    }
    return captureLedgerBackup(input, dbPath);
  });
};

async function withMaintenanceLock<T>(state: string, run: () => Promise<T>) {
  // A separate database keeps the maintenance lock independent of server writes.
  const lock = new Database(join(state, ".ledger-maintenance.db"), {
    timeout: 0,
  });
  try {
    try {
      lock.exec("BEGIN IMMEDIATE");
    } catch (error) {
      if (
        error instanceof Database.SqliteError &&
        error.code === "SQLITE_BUSY"
      ) {
        throw new Error(
          `A backup or restore is in progress at ${state}. Retry after it finishes.`,
        );
      }
      throw error;
    }
    return await run();
  } finally {
    lock.close();
  }
}

async function captureLedgerBackup(input: LedgerBackupRequest, dbPath: string) {
  const suppliedPath = resolve(input.destination);
  const destination = await canonicalPath(suppliedPath);
  rejectBackupRestoreMarker(destination);
  rejectBackupRestoreMarker(suppliedPath);
  if (input.devicePath) {
    const configuredDevice = resolve(input.devicePath);
    rejectPathAtOrBelow(suppliedPath, configuredDevice, "device path");
    const canonicalDevice = await canonicalPath(configuredDevice);
    rejectPathAtOrBelow(destination, canonicalDevice, "device path");
  }
  const parent = dirname(destination);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(parent, `.${basename(destination)}-`));
  let reserved = false;
  try {
    try {
      await mkdir(destination, { mode: 0o700 });
      reserved = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(
          `Backup destination already exists at ${destination}. Choose a new directory.`,
        );
      }
      throw error;
    }

    const snapshot = join(staging, DB_FILE);
    const source = new Database(dbPath, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      await source.backup(snapshot);
    } finally {
      source.close();
    }
    const standalone = new Database(snapshot, { fileMustExist: true });
    let projects: BackupProject[];
    try {
      standalone.pragma("journal_mode = DELETE");
      projects = projectRows(standalone);
    } finally {
      standalone.close();
    }
    const metadata = LedgerBackupMetadataSchema.parse({
      device: input.collectDevice(),
      projects,
      repositories: input.collectRepositories(projects),
    });
    const metadataPath = join(staging, METADATA_FILE);
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, {
      mode: 0o600,
    });
    const manifest = LedgerBackupManifestSchema.parse({
      schemaVersion: 1,
      createdAt: input.createdAt,
      gwrkVersion: input.gwrkVersion,
      dbSha256: await sha256(snapshot),
      metadataSha256: await sha256(metadataPath),
      summary: readLedger(snapshot, (db) => summarizeLedger(db, metadata)),
    });
    await writeFile(
      join(staging, MANIFEST_FILE),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { mode: 0o600 },
    );

    // The manifest commits the backup after both verified payload files exist.
    for (const filename of [DB_FILE, METADATA_FILE, MANIFEST_FILE]) {
      await syncPath(join(staging, filename));
      await rename(join(staging, filename), join(destination, filename));
    }
    await syncPath(destination);
    await syncPath(parent);
    return manifest;
  } catch (error) {
    if (reserved) await rm(destination, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function readRegularBackupFile(path: string): Promise<Buffer> {
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    if (!(await file.stat()).isFile()) {
      throw new Error(`Backup payload must contain regular files: ${path}`);
    }
    return await file.readFile();
  } finally {
    await file.close();
  }
}

async function readVerifiedLedgerBackup(directory: string) {
  const manifestPath = join(directory, MANIFEST_FILE);
  const manifestBytes = await readRegularBackupFile(manifestPath).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        throw new Error(
          `Backup manifest not found at ${manifestPath}. Run 'gwrk db backup --out <dir>'.`,
        );
      }
      throw error;
    },
  );
  const manifest = LedgerBackupManifestSchema.parse(
    JSON.parse(manifestBytes.toString("utf8")),
  );
  const dbPath = join(directory, DB_FILE);
  const metadataPath = join(directory, METADATA_FILE);
  if (!(await lstat(dbPath)).isFile()) {
    throw new Error("Backup payload must contain regular files.");
  }
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    if (await exists(dbPath + suffix))
      throw new Error("Backup database has an unexpected journal.");
  }
  if ((await sha256(dbPath)) !== manifest.dbSha256)
    throw new Error("Backup database digest mismatch.");
  const metadataBytes = await readRegularBackupFile(metadataPath);
  if (
    createHash("sha256").update(metadataBytes).digest("hex") !==
    manifest.metadataSha256
  ) {
    throw new Error("Backup metadata digest mismatch.");
  }
  const metadata = LedgerBackupMetadataSchema.parse(
    JSON.parse(metadataBytes.toString("utf8")),
  );
  const summary = readLedger(dbPath, (db) => summarizeLedger(db, metadata));
  if (!isDeepStrictEqual(summary, manifest.summary)) {
    throw new Error("Backup ledger summary does not match the manifest.");
  }
  const manifestSha256 = createHash("sha256")
    .update(manifestBytes)
    .digest("hex");
  return { manifest, metadata, manifestSha256 };
}

export const verifyLedgerBackup: LedgerBackupPort["verifyBackup"] = async (
  directory,
) => {
  const { manifest, metadata } = await readVerifiedLedgerBackup(directory);
  return { manifest, metadata };
};

function acceptedWorkRows(db: Database.Database) {
  return {
    completedRuns: db
      .prepare("SELECT * FROM runs WHERE finished_at IS NOT NULL ORDER BY id")
      .safeIntegers()
      .all(),
    history: db
      .prepare("SELECT * FROM history ORDER BY id")
      .safeIntegers()
      .all(),
  };
}

export async function verifyLedgerAgainstBackup(
  dbPath: string,
  backupDirectory: string,
): Promise<void> {
  const directory = resolve(backupDirectory);
  const { manifest, metadata } = await verifyLedgerBackup(directory);
  const backupRows = readLedger(join(directory, DB_FILE), acceptedWorkRows);
  const repoIds = new Set(
    metadata.repositories.map(({ projectId }) => projectId),
  );
  const matches = readLedger(dbPath, (db) => {
    const repositories = projectRows(db)
      .filter(({ id }) => repoIds.has(id))
      .map(({ id, path }) => readRepositoryEvidence(id, path));
    return (
      isDeepStrictEqual(
        summarizeLedger(db, { ...metadata, repositories }),
        manifest.summary,
      ) && isDeepStrictEqual(acceptedWorkRows(db), backupRows)
    );
  });
  if (!matches) {
    throw new Error("Live ledger does not match the pre-rollback backup.");
  }
}

async function statIfPresent(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  return Boolean(await statIfPresent(path));
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== "ENOENT" ||
      (await exists(path))
    ) {
      throw error;
    }
    return join(await canonicalPath(dirname(path)), basename(path));
  }
}

function rejectBackupRestoreMarker(path: string): void {
  const parts = path.split(sep);
  const marker = parts.indexOf(PENDING_LEDGER_RESTORE);
  if (marker !== -1) {
    rejectPathAtOrBelow(
      path,
      parts.slice(0, marker + 1).join(sep),
      "restore path",
    );
  }
}

function rejectReservedRestorePath(path: string, state: string): void {
  rejectPathAtOrBelow(
    path,
    join(state, PENDING_LEDGER_RESTORE),
    "restore path",
  );
}

function rejectPathAtOrBelow(
  path: string,
  reserved: string,
  label: string,
): void {
  const offset = relative(reserved, path);
  if (
    !isAbsolute(offset) &&
    offset !== ".." &&
    !offset.startsWith(`..${sep}`)
  ) {
    throw new Error(`Path ${path} uses the reserved ${label} ${reserved}.`);
  }
}

export const restoreLedgerBackup: LedgerBackupPort["restoreBackup"] = async (
  input,
) => {
  const state = await canonicalPath(resolve(input.stateDirectory));
  const suppliedPath = resolve(input.source);
  rejectReservedRestorePath(suppliedPath, state);
  const sourceDirectory = await canonicalPath(suppliedPath);
  rejectReservedRestorePath(sourceDirectory, state);
  const source = await readVerifiedLedgerBackup(sourceDirectory);
  await mkdir(state, { recursive: true, mode: 0o700 });
  return withMaintenanceLock(state, () =>
    installLedgerBackup(state, sourceDirectory, source, input.force),
  );
};

async function installLedgerBackup(
  state: string,
  sourceDirectory: string,
  source: Awaited<ReturnType<typeof readVerifiedLedgerBackup>>,
  force: boolean,
) {
  const pending = join(state, PENDING_LEDGER_RESTORE);
  const pendingInfo = await statIfPresent(pending);
  const transaction = {
    schemaVersion: 1,
    stateDirectory: state,
    manifestSha256: source.manifestSha256,
  };
  const targets = [
    DB_FILE,
    `${DB_FILE}-wal`,
    `${DB_FILE}-shm`,
    `${DB_FILE}-journal`,
    DEVICE_FILE,
  ];
  if (
    !pendingInfo &&
    !force &&
    (await Promise.all(targets.map((file) => exists(join(state, file))))).some(
      Boolean,
    )
  ) {
    throw new Error(
      `Target state at ${state} already contains ledger or device files. Choose a clean directory or pass '--force'.`,
    );
  }

  for (const file of targets) {
    const target = join(state, file);
    const info = await statIfPresent(target);
    if (info && !info.isFile()) {
      throw new Error(`Restore target must be a regular file: ${target}`);
    }
  }

  if (pendingInfo) {
    if (!pendingInfo.isDirectory()) {
      throw new Error(`Pending restore must be a directory: ${pending}`);
    }
    const record = await readRegularBackupFile(
      join(pending, RESTORE_TRANSACTION_FILE),
    )
      .then((bytes) => JSON.parse(bytes.toString("utf8")) as unknown)
      .catch((error: unknown) => {
        throw new Error(`Cannot read restore transaction at ${pending}.`, {
          cause: error,
        });
      });
    if (!isDeepStrictEqual(record, transaction)) {
      throw new Error(
        `Restore transaction at ${pending} does not match the target and supplied backup. Retry with its original backup.`,
      );
    }
  } else {
    const staging = await mkdtemp(join(state, ".restore-stage-"));
    try {
      for (const file of [DB_FILE, METADATA_FILE, MANIFEST_FILE]) {
        await copyFile(join(sourceDirectory, file), join(staging, file));
        await syncPath(join(staging, file));
      }
      const staged = await readVerifiedLedgerBackup(staging);
      if (!isDeepStrictEqual(staged, source))
        throw new Error("Backup changed during restore staging.");
      const recordPath = join(staging, RESTORE_TRANSACTION_FILE);
      await writeFile(recordPath, `${JSON.stringify(transaction)}\n`, {
        mode: 0o600,
      });
      await syncPath(recordPath);
      await syncPath(staging);
      await rename(staging, pending);
      await syncPath(state);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  const staged = await readVerifiedLedgerBackup(pending);
  if (!isDeepStrictEqual(staged, source)) {
    throw new Error(
      `An unfinished restore exists at ${pending}. Retry with its original backup.`,
    );
  }
  const { manifest, metadata } = staged;
  const verified: VerifiedLedgerBackup = { manifest, metadata };

  const stagedDb = join(pending, "install.db");
  const stagedDevice = join(pending, DEVICE_FILE);
  const installedDb = join(state, DB_FILE);
  const installedDevice = join(state, DEVICE_FILE);
  const { device } = verified.metadata;
  await copyFile(join(pending, DB_FILE), stagedDb);
  await syncPath(stagedDb);
  if (device) {
    await writeFile(stagedDevice, `${JSON.stringify(device, null, 2)}\n`, {
      mode: 0o600,
    });
    await syncPath(stagedDevice);
  }

  for (const suffix of ["-wal", "-shm", "-journal"]) {
    await rm(installedDb + suffix, { force: true });
  }
  await rename(stagedDb, installedDb);
  if (device) {
    await rename(stagedDevice, installedDevice);
  } else {
    await rm(installedDevice, { force: true });
  }

  if ((await sha256(installedDb)) !== verified.manifest.dbSha256) {
    throw new Error("Installed ledger digest does not match the backup.");
  }
  if (
    !isDeepStrictEqual(
      readLedger(installedDb, (db) => summarizeLedger(db, verified.metadata)),
      verified.manifest.summary,
    )
  ) {
    throw new Error("Installed ledger summary does not match the backup.");
  }
  await syncPath(state);
  const retired = await mkdtemp(join(state, ".restore-complete-"));
  await rename(pending, join(retired, "transaction"));
  await syncPath(state);
  await rm(retired, { recursive: true, force: true });
  return verified;
}
