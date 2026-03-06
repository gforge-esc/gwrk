import { Command } from "commander";
import { loadConfig } from "../utils/config.js";
import { startServer } from "../server/index.js";
import { readPid, isPidRunning } from "../server/pid.js";

export const serverCommand = new Command("server")
  .description("Manage gwrk build server daemon");

serverCommand.command("start")
  .description("Start the gwrk build server daemon")
  .action(async () => {
    const projectRoot = process.cwd();
    const config = loadConfig(projectRoot);
    
    const pid = readPid();
    if (pid && isPidRunning(pid)) {
      console.error(`Server already running (pid: ${pid})`);
      process.exit(1);
    }
    
    await startServer(config);
  });

serverCommand.command("stop")
  .description("Stop the gwrk build server daemon")
  .action(async () => {
    const pid = readPid();
    if (!pid || !isPidRunning(pid)) {
      console.error("No server running");
      process.exit(1);
    }
    
    process.kill(pid, "SIGTERM");
    console.log(`Stopping server (pid: ${pid})...`);
    
    // Wait for PID to disappear (30s max as per spec)
    for (let i = 0; i < 30; i++) {
       if (!isPidRunning(pid)) {
         console.log("Server stopped.");
         return;
       }
       await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.error("Server failed to stop gracefully");
    process.exit(1);
  });
