/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import Database from "better-sqlite3";
import {
  type LedgerBackupManifest,
  LedgerBackupManifestSchema,
  type LedgerBackupMetadata,
  LedgerBackupMetadataSchema,
  type LedgerSummary,
  PENDING_LEDGER_RESTORE,
} from "../../domain/ledger-backup.js";
import type {
  LedgerBackupPort,
  LedgerBackupRequest,
} from "../../ports/release-ops-port.js";
import { sha256 } from "../release/inventory.js";

const DB_FILE = "gwrk.db";
const METADATA_FILE = "repo-metadata.json";
const MANIFEST_FILE = "backup-manifest.json";
const DEVICE_FILE = "device.json";

async function syncPath(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function readAppliedMigrations(dbPath: string): string[] {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return appliedMigrations(db);
  } finally {
    db.close();
  }
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

type RepositoryEvidence = LedgerBackupMetadata["repositories"];
type SnapshotBackupRequest = Omit<LedgerBackupRequest, "metadata"> & {
  metadata: Omit<LedgerBackupRequest["metadata"], "repositories"> & {
    repositories:
      | RepositoryEvidence
      | ((projects: BackupProject[]) => RepositoryEvidence);
  };
};

export async function createLedgerBackup(
  input: SnapshotBackupRequest,
): Promise<LedgerBackupManifest> {
  const destination = resolve(input.destination);
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
    const source = new Database(input.dbPath, {
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
    const { device, repositories } = input.metadata;
    const metadata = LedgerBackupMetadataSchema.parse({
      device,
      projects,
      repositories:
        typeof repositories === "function"
          ? repositories(projects)
          : repositories,
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

export const verifyLedgerBackup: LedgerBackupPort["verifyBackup"] = async (
  directory,
) => {
  const manifestPath = join(directory, MANIFEST_FILE);
  const text = await readFile(manifestPath, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        throw new Error(
          `Backup manifest not found at ${manifestPath}. Run 'gwrk db backup --out <dir>'.`,
        );
      }
      throw error;
    },
  );
  const manifest = LedgerBackupManifestSchema.parse(JSON.parse(text));
  const dbPath = join(directory, DB_FILE);
  const metadataPath = join(directory, METADATA_FILE);
  for (const path of [manifestPath, dbPath, metadataPath]) {
    if (!(await lstat(path)).isFile())
      throw new Error("Backup payload must contain regular files.");
  }
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    if (await exists(dbPath + suffix))
      throw new Error("Backup database has an unexpected journal.");
  }
  if ((await sha256(dbPath)) !== manifest.dbSha256)
    throw new Error("Backup database digest mismatch.");
  const metadataBytes = await readFile(metadataPath);
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
  const matches = readLedger(
    dbPath,
    (db) =>
      isDeepStrictEqual(summarizeLedger(db, metadata), manifest.summary) &&
      isDeepStrictEqual(acceptedWorkRows(db), backupRows),
  );
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

export const restoreLedgerBackup: LedgerBackupPort["restoreBackup"] = async (
  input,
) => {
  const state = resolve(input.stateDirectory);
  const pending = join(state, PENDING_LEDGER_RESTORE);
  const source = await verifyLedgerBackup(input.source);
  const resuming = await exists(pending);
  const targets = [
    DB_FILE,
    `${DB_FILE}-wal`,
    `${DB_FILE}-shm`,
    `${DB_FILE}-journal`,
    DEVICE_FILE,
  ];
  if (
    !resuming &&
    !input.force &&
    (await Promise.all(targets.map((file) => exists(join(state, file))))).some(
      Boolean,
    )
  ) {
    throw new Error(
      `Target state at ${state} already contains ledger or device files. Choose a clean directory or pass '--force'.`,
    );
  }

  // The hosted instance lock keeps writers out during validation and installation.
  for (const file of targets) {
    const target = join(state, file);
    const info = await statIfPresent(target);
    if (info && !info.isFile()) {
      throw new Error(`Restore target must be a regular file: ${target}`);
    }
  }

  if (!resuming) {
    await mkdir(state, { recursive: true, mode: 0o700 });
    const staging = await mkdtemp(join(state, ".restore-stage-"));
    try {
      for (const file of [DB_FILE, METADATA_FILE, MANIFEST_FILE]) {
        await copyFile(join(input.source, file), join(staging, file));
        await syncPath(join(staging, file));
      }
      const staged = await verifyLedgerBackup(staging);
      if (!isDeepStrictEqual(staged, source))
        throw new Error("Backup changed during restore staging.");
      await syncPath(staging);
      await rename(staging, pending);
      await syncPath(state);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  const verified = await verifyLedgerBackup(pending);
  if (!isDeepStrictEqual(verified, source)) {
    throw new Error(
      `An unfinished restore exists at ${pending}. Retry with its original backup.`,
    );
  }

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
};
