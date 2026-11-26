/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { z } from "zod";
import {
  type RunnerScope,
  assertNoSecretMaterial,
} from "../../domain/model-qualification.js";
import type { RouteLockStorePort } from "../../ports/model-qualification-port.js";

const text = z.string().refine((value) => Boolean(value.trim()));
const identity = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const scopeSchema = z.object({
  workspaceId: text,
  runnerProfile: identity,
  platform: text,
  arch: text,
});
const model = z.object({
  backend: text,
  provider: text,
  family: text,
  modelId: text,
});
const snapshotSchema = z.object({
  scope: scopeSchema,
  adapters: z.array(
    z.object({
      backend: text,
      status: z.enum([
        "available",
        "auth_error",
        "rate_limited",
        "unavailable",
        "unconfigured",
      ]),
      cliVersion: z.string(),
      adapterVersion: z.string(),
      supportsModelForwarding: z.boolean(),
      error: z.string().optional(),
      models: z.array(
        model.extend({
          supportedEfforts: z.array(z.string()),
          isDefault: z.boolean(),
          hidden: z.boolean(),
        }),
      ),
    }),
  ),
});
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const pinSchema = model.extend({
  role: z.enum(["define", "implement", "review", "judge"]),
  routeMode: z.enum(["pinned", "provider-default"]),
  effort: text.optional(),
  fallbackRoutes: z.array(
    model.extend({ effort: text.optional(), evaluationId: identity }),
  ),
  toolVersions: z.object({ cliVersion: text, adapterVersion: text }),
  evidence: z.object({
    evaluationId: identity,
    snapshotHash: digest,
    evaluationBundleHash: digest,
    fixtureSuiteHash: digest,
    workflowPromptHashes: z.record(digest),
    judgeVerdictHashes: z.tuple([digest, digest]),
  }),
});
const baseLock = z.object({
  schemaVersion: z.literal(1),
  workspaceId: text,
  runnerProfile: identity,
  updatedAt: z.string().datetime({ offset: true }),
  routes: z
    .object({
      define: pinSchema.optional(),
      implement: pinSchema.optional(),
      review: pinSchema.optional(),
    })
    .strict(),
  judges: z.tuple([pinSchema, pinSchema]).optional(),
});
const lockSchema = baseLock.extend({ previousLock: baseLock.optional() });
const changeSchema = z
  .object({ document: lockSchema, expectedIncumbentDigest: digest.nullable() })
  .strict();
const hash = (bytes: string) =>
  createHash("sha256").update(bytes).digest("hex");
const errorCode = (error: unknown) =>
  error && typeof error === "object" && "code" in error
    ? error.code
    : undefined;

function guardSecrets(value: unknown) {
  const secrets = Object.entries(process.env)
    .filter(
      ([key, value]) =>
        /(?:TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL|AUTHORIZATION)/i.test(
          key,
        ) && Boolean(value),
    )
    .flatMap(([, value]) => (value ? [value] : []));
  assertNoSecretMaterial(value, secrets);
}
function validateDocument(
  scope: RunnerScope,
  document: z.infer<typeof lockSchema>,
) {
  if (
    document.workspaceId !== scope.workspaceId ||
    document.runnerProfile !== scope.runnerProfile
  )
    throw new Error("runner-mismatch");
  for (const current of [document, document.previousLock]) {
    if (!current) continue;
    if (
      current.workspaceId !== scope.workspaceId ||
      current.runnerProfile !== scope.runnerProfile
    )
      throw new Error("runner-mismatch");
    for (const [role, pin] of Object.entries(current.routes))
      if (pin && pin.role !== role) throw new Error("route-role-mismatch");
    if (current.judges?.some((pin) => pin.role !== "judge"))
      throw new Error("judge-role-mismatch");
  }
}

export function parseRouteLockDocument(scope: RunnerScope, value: unknown) {
  guardSecrets(value);
  const document = lockSchema.parse(value);
  validateDocument(scope, document);
  return document;
}

export function createRouteLockStore(projectRoot: string): RouteLockStorePort {
  const root = realpathSync(resolve(projectRoot));
  const locate = (parts: string[], create = false): string | null => {
    let directory = root;
    for (const part of parts) {
      directory = join(directory, part);
      if (create) {
        try {
          mkdirSync(directory, { mode: 0o700 });
        } catch (error) {
          if (errorCode(error) !== "EEXIST") throw error;
        }
      }
      let info: ReturnType<typeof lstatSync>;
      try {
        info = lstatSync(directory);
      } catch (error) {
        if (!create && errorCode(error) === "ENOENT") return null;
        throw error;
      }
      if (info.isSymbolicLink() || !info.isDirectory())
        throw new Error("Invalid model storage directory");
    }
    return directory;
  };
  const ensure = (parts: string[]) => {
    const directory = locate(parts, true);
    if (directory === null)
      throw new Error("Model storage directory unavailable");
    return directory;
  };
  const read = (file: string): string | null => {
    try {
      const info = lstatSync(file);
      if (!info.isFile() || info.isSymbolicLink())
        throw new Error("Invalid model storage file");
      return readFileSync(file, "utf8");
    } catch (error) {
      if (errorCode(error) === "ENOENT") return null;
      throw error;
    }
  };
  const atomicWrite = (file: string, bytes: string) => {
    const temporary = join(dirname(file), `.model-write-${randomUUID()}.tmp`);
    let fd: number | undefined;
    try {
      fd = openSync(temporary, "wx", 0o600);
      writeFileSync(fd, bytes, "utf8");
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      renameSync(temporary, file);
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  };
  const lockFile = (scope: RunnerScope) => {
    scopeSchema.parse(scope);
    return join(
      ensure([".gwrk", "models"]),
      `route-lock.${scope.runnerProfile}.json`,
    );
  };
  return {
    async writeDiscoverySnapshot(scope, snapshot) {
      guardSecrets(snapshot);
      const parsed = snapshotSchema.parse(snapshot);
      scopeSchema.parse(scope);
      if (
        Object.entries(scope).some(
          ([key, value]) => parsed.scope[key as keyof RunnerScope] !== value,
        )
      )
        throw new Error("runner-mismatch");
      const file = join(
        ensure([".runs", "models", "discovery"]),
        `${scope.runnerProfile}.json`,
      );
      atomicWrite(file, `${JSON.stringify(parsed, null, 2)}\n`);
      return file;
    },
    async readDiscoverySnapshot(scope) {
      scopeSchema.parse(scope);
      const directory = locate([".runs", "models", "discovery"]);
      if (directory === null) return null;
      const file = join(directory, `${scope.runnerProfile}.json`);
      const bytes = read(file);
      if (bytes === null) return null;
      const value = JSON.parse(bytes);
      guardSecrets(value);
      const parsed = snapshotSchema.parse(value);
      if (
        Object.entries(scope).some(
          ([key, value]) => parsed.scope[key as keyof RunnerScope] !== value,
        )
      )
        throw new Error("runner-mismatch");
      return parsed;
    },
    async writeEvaluationBundle(evaluationId, bundle) {
      identity.parse(evaluationId);
      guardSecrets(bundle);
      const bytes = `${JSON.stringify(bundle, null, 2)}\n`;
      const file = join(
        ensure([".runs", "models", "evaluations", evaluationId]),
        "bundle.json",
      );
      try {
        writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
      } catch (error) {
        if (errorCode(error) !== "EEXIST" || read(file) !== bytes) throw error;
      }
      return file;
    },
    async readEvaluationBundle(evaluationId) {
      identity.parse(evaluationId);
      const directory = locate([
        ".runs",
        "models",
        "evaluations",
        evaluationId,
      ]);
      if (directory === null) throw new Error("Evaluation bundle not found");
      const bytes = read(join(directory, "bundle.json"));
      if (bytes === null) throw new Error("Evaluation bundle not found");
      const value = JSON.parse(bytes);
      guardSecrets(value);
      return value;
    },
    async readRouteLock(scope) {
      scopeSchema.parse(scope);
      const directory = locate([".gwrk", "models"]);
      if (directory === null) return null;
      const bytes = read(
        join(directory, `route-lock.${scope.runnerProfile}.json`),
      );
      if (bytes === null) return null;
      return {
        digest: hash(bytes),
        document: parseRouteLockDocument(scope, JSON.parse(bytes)),
      };
    },
    async writeRouteLockAtomic(scope, request) {
      scopeSchema.parse(scope);
      guardSecrets(request);
      const change = changeSchema.parse(request);
      validateDocument(scope, change.document);
      const bytes = `${JSON.stringify(change.document, null, 2)}\n`;
      const mutexDirectory = ensure([".runs", "models"]);
      const mutexPath = join(mutexDirectory, "route-writes.sqlite");
      if (existsSync(mutexPath) && lstatSync(mutexPath).isSymbolicLink())
        throw new Error("Invalid model mutex file");
      const mutex = new Database(mutexPath);
      try {
        mutex.pragma("busy_timeout = 5000");
        return mutex
          .transaction(() => {
            const file = lockFile(scope);
            const incumbent = read(file);
            if (
              (incumbent === null ? null : hash(incumbent)) !==
              change.expectedIncumbentDigest
            )
              throw new Error("incumbent-changed");
            atomicWrite(file, bytes);
            return hash(bytes);
          })
          .immediate();
      } finally {
        mutex.close();
      }
    },
  };
}
