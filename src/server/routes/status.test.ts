/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createServerFixture } from "../../../tests/helpers/server-fixture.js";

describe("status routes (FR-004, US-002)", () => {
  it("responds with status when the sandbox inventory is empty", async () => {
    const fixture = await createServerFixture("routes", { routes: ["status"] });
    try {
      const response = await fixture.app.inject({
        method: "GET",
        url: "/api/status",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(body.server.status).toBe("running");
      expect(body.server.lifecycle).toBe("ready");
      expect(body.server.pid).toBe(process.pid);

      expect(body.sandboxes).toEqual([]);

      expect(body.system.cpuPercent).toBeDefined();
      expect(body.system.memPercent).toBeDefined();
      expect(body.system.diskFreeGb).toBeDefined();

      expect(body.network.status).toBeDefined();
    } finally {
      await fixture.close();
    }
    expect(fixture.db.open).toBe(false);
    expect(existsSync(fixture.projectRoot)).toBe(false);
  });
});
