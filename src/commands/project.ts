import { Command } from "commander";
import { projectInfoCommand } from "./project-info.js";
import { projectDiscoverCommand } from "./project-discover.js";
import {
  projectSpecsCommand,
  projectGatesCommand,
} from "./project-specs-gates.js";

/**
 * src/commands/project.ts
 * Phase 13: Project Awareness — Agent-Native Interface
 */
export const projectCommand = new Command("project")
  .description("Project management commands")
  .addCommand(projectInfoCommand)
  .addCommand(projectDiscoverCommand)
  .addCommand(projectSpecsCommand)
  .addCommand(projectGatesCommand);
