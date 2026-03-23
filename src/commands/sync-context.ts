import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { color } from "../utils/format.js";
import { withSignal } from "../utils/signal.js";
import { AgentBackendRegistry } from "../plugins/agent-registry.js";
import { PluginLoader } from "../plugins/loader.js";

const { GREEN, YELLOW, RESET } = color;

/**
 * FR-L1-006: Synchronize agent context files (GEMINI.md, CLAUDE.md) from .gwrk/agent-context.md
 */
export async function syncAgentContext() {
  const projectRoot = process.cwd();
  const contextPath = path.join(projectRoot, ".gwrk", "agent-context.md");
  let governance = "";
  try {
    governance = await fs.readFile(contextPath, "utf-8");
  } catch (e) {
    console.warn(`${YELLOW}Warning: .gwrk/agent-context.md not found. Using empty governance.${RESET}`);
  }

  const registry = new AgentBackendRegistry(new PluginLoader());
  await registry.syncAllBackends(projectRoot, governance);
}

/**
 * Command definition for gwrk plugin sync-context
 */
export const syncContextCommand = new Command("sync-context")
  .description("Synchronize agent context files (GEMINI.md, CLAUDE.md) from .gwrk/agent-context.md")
  .action(async () => {
    await withSignal("plugin sync-context", async () => {
      await syncAgentContext();
      console.log(`${GREEN}Synchronized context files for all active agent backends.${RESET}`);
    });
  });
