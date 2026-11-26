/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fastify from "fastify";
import { expect, it } from "vitest";
import { registerHostedAuthGuard } from "./auth-guard.js";

it("FR-002 maps account policy denial to 403 without operational effects", async () => {
  const server = fastify({ logger: false });
  let effects = 0;
  registerHostedAuthGuard(server, {
    authenticate: async () => ({
      ok: false,
      code: "AUTH_ACCOUNT_DENIED",
      message: "Authentication denied",
    }),
  });
  server.get("/api/status", async () => {
    effects++;
    return {};
  });
  try {
    const response = await server.inject({
      method: "GET",
      url: "/api/status",
      headers: { authorization: "Bearer synthetic-denied-account" },
    });
    expect.soft(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      ok: false,
      code: "AUTH_ACCOUNT_DENIED",
      requestId: expect.any(String),
    });
    expect(effects).toBe(0);
  } finally {
    await server.close();
  }
});
