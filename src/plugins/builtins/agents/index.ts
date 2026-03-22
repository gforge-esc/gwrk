import { GeminiAdapter } from "./gemini/adapter.js";
import { ClaudeAdapter } from "./claude/adapter.js";
import { CodexAdapter } from "./codex/adapter.js";
import type { AgentBackend } from "../../../agent-backend.js";

export const builtInAgents: Record<string, AgentBackend> = {
  gemini: new GeminiAdapter(),
  claude: new ClaudeAdapter(),
  codex: new CodexAdapter(),
};
