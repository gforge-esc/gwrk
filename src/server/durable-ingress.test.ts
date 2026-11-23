/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { afterEach, describe, expect, it } from "vitest";
import {
  type ServerFixture,
  createServerFixture,
} from "../../tests/helpers/server-fixture.js";
import { resolveProjectId } from "../adapters/git/project-id.js";
import {
  createSqliteOperationsStoreAdapter,
  createSqliteProjectRegistryAdapter,
} from "../adapters/sqlite/index.js";

describe("durable HTTP ingress", () => {
  let fixture: ServerFixture | undefined;
  afterEach(async () => {
    await fixture?.close();
  });
  it("commits a project-scoped operation before acknowledgement and replays its receipt", async () => {
    fixture = await createServerFixture("routes", {
      routes: ["dispatch"],
      pauseDispatch: true,
    });
    const projectId = resolveProjectId(fixture.projectRoot);
    createSqliteProjectRegistryAdapter({ db: fixture.db }).enrollProject({
      projectId,
      slug: fixture.projectId.toLowerCase(),
      name: "Synthetic ingress project",
      repoSlug: null,
      trunkBranch: "develop",
      localRoot: fixture.projectRoot,
      mirrorPath: null,
      runnerPolicy: { allowedKinds: ["local"] },
      slack: null,
      legacyProjectIds: [],
      createdAt: "2026-11-23T12:00:00.000Z",
      updatedAt: "2026-11-23T12:00:00.000Z",
    });
    const payload = {
      projectId,
      featureId: "049-durable-ingress",
      phaseId: "phase-01",
      backend: "agy",
    };
    const first = await fixture.app.inject({
      method: "POST",
      url: "/api/dispatch",
      payload,
    });
    expect(first.statusCode).toBe(201);
    const store = createSqliteOperationsStoreAdapter({ db: fixture.db });
    const operation = store.getDispatchOperation(payload);
    expect(
      operation,
      "acknowledged work must already exist in SQLite",
    ).not.toBeNull();
    expect(first.json().operationId).toBe(operation?.operationId);
    expect(first.json().projectId).toBe(projectId);
    expect(
      store.getDispatchOperation({
        ...payload,
        projectId: "unrelated-project",
      }),
    ).toBeNull();
    const replay = await fixture.app.inject({
      method: "POST",
      url: "/api/dispatch",
      payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().operationId).toBe(operation?.operationId);
  });
});
