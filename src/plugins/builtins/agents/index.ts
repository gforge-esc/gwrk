import type { AgentBackend } from "../../agent-backend.js";
import { ClaudeAdapter } from "./claude/adapter.js";
import { CodexAdapter } from "./codex/adapter.js";
import { GeminiAdapter } from "./gemini/adapter.js";

export const BUILTIN_AGENTS: Record<string, AgentBackend> = {
  gemini: new GeminiAdapter(),
  claude: new ClaudeAdapter(),
  codex: new CodexAdapter(),
};

export const builtInAgents = BUILTIN_AGENTS;

export { GeminiAdapter, ClaudeAdapter, CodexAdapter };
