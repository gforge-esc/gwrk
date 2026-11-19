/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createAgentPortAdapter } from "../adapters/agents/index.js";
import type { AgentBackend } from "../plugins/agent-backend.js";
import { AgentBackendRegistry } from "../plugins/agent-registry.js";
import type { RoutingContext } from "../ports/agent-port.js";

export async function selectBackend(
  task: RoutingContext,
  projectRoot: string = process.cwd(),
  registry = new AgentBackendRegistry(),
): Promise<AgentBackend> {
  const adapter = createAgentPortAdapter({ projectRoot, registry });
  const route = await adapter.selectRoute(task);
  return registry.getAgentBackend(route.backend);
}
