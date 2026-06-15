import type { AgentBackend } from "../../agent-backend.js";
import { AgyAdapter } from "./agy/adapter.js";
import { ClaudeAdapter } from "./claude/adapter.js";
import { CodexAdapter } from "./codex/adapter.js";
import { GeminiAdapter } from "./gemini/adapter.js";

export const BUILTIN_AGENTS: Record<string, AgentBackend> = {
  agy: new AgyAdapter(),
  gemini: new GeminiAdapter(),
  claude: new ClaudeAdapter(),
  codex: new CodexAdapter(),
};

const builtInAgents = BUILTIN_AGENTS;

export { AgyAdapter, GeminiAdapter, ClaudeAdapter, CodexAdapter };
