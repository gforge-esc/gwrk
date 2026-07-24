/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { AgentBackend } from "../../agent-backend.js";
import { AgyAdapter } from "./agy/adapter.js";
import { ClaudeAdapter } from "./claude/adapter.js";
import { CodexAdapter } from "./codex/adapter.js";

export const BUILTIN_AGENTS: Record<string, AgentBackend> = {
  agy: new AgyAdapter(),
  claude: new ClaudeAdapter(),
  codex: new CodexAdapter(),
};

const builtInAgents = BUILTIN_AGENTS;

export { AgyAdapter, ClaudeAdapter, CodexAdapter };
