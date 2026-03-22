import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Command } from "commander";
import { builtInAgents } from "../plugins/builtins/agents/index.js";
import { color } from "../utils/format.js";
import { withSignal } from "../utils/signal.js";
import { getDb } from "../db/index.js";

const { GREEN, RED, RESET, BOLD } = color;

/**
 * FR-L1-006: Sync governance context across all active agent backends.
 */
export async function syncContext(projectRoot: string) {
  const contextPath = path.join(projectRoot, ".gwrk", "agent-context.md");
  
  let governance = "";
  try {
    governance = await fs.readFile(contextPath, "utf-8");
  } catch (e) {
    // If agent-context.md is missing, try to migrate from legacy or use a default
    const legacyPath = path.join(projectRoot, ".agents", "rules", "workspace.md");
    try {
      governance = await fs.readFile(legacyPath, "utf-8");
      console.log(`${BOLD}${GREEN}Migrating governance from legacy .agents/rules/workspace.md${RESET}`);
      await fs.mkdir(path.join(projectRoot, ".gwrk"), { recursive: true });
      await fs.writeFile(contextPath, governance, "utf-8");
    } catch (e2) {
      throw new Error(`Governance source '.gwrk/agent-context.md' not found. Run 'gwrk init' first.`);
    }
  }

  const contextHash = crypto.createHash("sha256").update(governance).digest("hex");
  const db = getDb();

  const results = await Promise.allSettled(
    Object.values(builtInAgents).map(async (adapter) => {
      // Check if sync is needed (hash check)
      const row = db.prepare(
        "SELECT context_hash FROM agent_context_sync WHERE project_root = ? AND backend_name = ?"
      ).get(projectRoot, adapter.name) as { context_hash: string } | undefined;

      if (row?.context_hash === contextHash) {
        // Skip sync if hash matches
        return { name: adapter.name, skipped: true };
      }

      await adapter.syncGovernance(projectRoot, governance);

      // Update sync state in DB
      db.prepare(
        `INSERT INTO agent_context_sync (project_root, backend_name, last_sync_at, context_hash)
         VALUES (?, ?, datetime('now'), ?)
         ON CONFLICT(project_root, backend_name) DO UPDATE SET
           last_sync_at = datetime('now'),
           context_hash = excluded.context_hash`
      ).run(projectRoot, adapter.name, contextHash);

      return { name: adapter.name, skipped: false };
    })
  );

  for (const res of results) {
    if (res.status === "fulfilled") {
      const { name, skipped } = res.value;
      if (skipped) {
        console.log(`${GREEN}- ${name} already synced (no changes)${RESET}`);
      } else {
        console.log(`${GREEN}✓ Synced governance for ${name}${RESET}`);
      }
    } else {
      console.error(`${RED}✗ Failed to sync governance: ${res.reason.message}${RESET}`);
    }
  }
}

/**
 * Command definition for 'gwrk plugin sync-context'
 */
export const syncContextCommand = new Command("sync-context")
  .description("Regenerate CLI-specific context files from .gwrk/agent-context.md")
  .action(async () => {
    await withSignal("plugin sync-context", async () => {
      await syncContext(process.cwd());
    });
  });
