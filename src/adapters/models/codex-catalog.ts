/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { z } from "zod";
import type { DiscoveredModel } from "../../domain/model-qualification.js";

const ModelPage = z.object({
  data: z.array(
    z.object({
      model: z.string().min(1),
      hidden: z.boolean(),
      isDefault: z.boolean(),
      supportedReasoningEfforts: z.array(
        z.object({ reasoningEffort: z.string().min(1) }),
      ),
    }),
  ),
  nextCursor: z.string().nullable(),
});

export async function readCodexModelCatalog(
  [command, ...args]: readonly [string, ...string[]] = ["codex", "app-server"],
  timeoutMs = 10_000,
): Promise<DiscoveredModel[]> {
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "ignore"] });
  const lines = createInterface({ input: child.stdout });
  const responses = lines[Symbol.asyncIterator]();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  let sequence = 0;

  const send = (message: object) =>
    new Promise<void>((resolve, reject) => {
      child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

  const request = async (method: string, params: object): Promise<unknown> => {
    const id = ++sequence;
    await send({ id, method, params });
    while (true) {
      const response = await responses.next();
      if (response.done) throw new Error(`Codex closed during ${method}.`);
      const envelope = JSON.parse(response.value);
      if (envelope?.id !== id) continue;
      if (envelope.error) {
        throw new Error(
          `Codex ${method} failed: ${envelope.error.message ?? "unknown error"}`,
        );
      }
      return envelope.result;
    }
  };

  try {
    await once(child, "spawn");
    await request("initialize", {
      clientInfo: { name: "gwrk", version: "1.0.0" },
    });
    await send({ method: "initialized" });
    const cursors = new Set<string>();
    const models = new Map<string, DiscoveredModel>();
    let cursor: string | null = null;
    do {
      const page = ModelPage.parse(
        await request("model/list", {
          includeHidden: false,
          limit: 50,
          cursor,
        }),
      );
      for (const entry of page.data) {
        if (
          entry.hidden ||
          /^(auto|default|latest|unknown)$/i.test(entry.model)
        ) {
          continue;
        }
        models.set(entry.model, {
          backend: "codex",
          provider: "openai",
          family: /^o\d/.test(entry.model) ? "o-series" : "gpt",
          modelId: entry.model,
          supportedEfforts: [
            ...new Set(
              entry.supportedReasoningEfforts.map(
                ({ reasoningEffort }) => reasoningEffort,
              ),
            ),
          ],
          isDefault: entry.isDefault,
          hidden: false,
        });
      }
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor)) {
        throw new Error("Codex repeated a model catalog cursor.");
      }
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return [...models.values()];
  } catch (error) {
    if (timedOut)
      throw new Error("Codex model catalog timed out.", { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
    lines.close();
    child.stdin.destroy();
    child.stdout.destroy();
    child.kill();
  }
}
