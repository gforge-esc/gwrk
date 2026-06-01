import { Command } from "commander";
import { projectInfoCommand } from "./project-info.js";

/**
 * NEW: src/commands/project.ts
 * Phase 13: Project Awareness
 */
export const projectCommand = new Command("project")
  .description("Project management commands")
  .addCommand(projectInfoCommand);
