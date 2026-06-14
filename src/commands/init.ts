import { Command } from "commander";

export const initCommand = new Command("init")
  .description("Initialize a new gwrk project")
  .action(() => {
    throw new Error("Not implemented");
  });
