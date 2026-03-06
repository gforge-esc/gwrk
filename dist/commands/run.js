import { Command } from "commander";
import { specifyCommand } from "./specify.js";
import { planCommand } from "./plan.js";
import { analyzeCommand } from "./analyze.js";
export const runCommand = new Command("run")
    .description("Directly invoke agent workflows")
    .addCommand(specifyCommand)
    .addCommand(planCommand)
    .addCommand(analyzeCommand);
