/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Command } from "commander";
import { createProjectDiscoverCommand } from "./project-discover.js";
import { createProjectInfoCommand } from "./project-info.js";
import {
  createProjectGatesCommand,
  createProjectSpecsCommand,
} from "./project-specs-gates.js";

/**
 * src/commands/project.ts
 * Phase 13: Project Awareness — Agent-Native Interface
 */
export const createProjectCommand = () =>
  new Command("project")
    .description("Project management commands")
    .addCommand(createProjectInfoCommand())
    .addCommand(createProjectDiscoverCommand())
    .addCommand(createProjectSpecsCommand())
    .addCommand(createProjectGatesCommand());

export const projectCommand = createProjectCommand();
