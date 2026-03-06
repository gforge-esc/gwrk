import { Command } from "commander";
import { loadConfig } from "../utils/config.js";

export const statusCommand = new Command("status")
  .description("Show gwrk system status")
  .option("--json", "Output status as JSON")
  .action(async (options) => {
    const projectRoot = process.cwd();
    const config = loadConfig(projectRoot);
    
    const url = `http://${config.server.host}:${config.server.port}/api/status`;
    
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const status = await response.json();
      
      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log(`Server: ${status.server.status} (pid: ${status.server.pid})`);
        console.log(`CPU: ${status.system.cpuPercent}% | MEM: ${status.system.memPercent}% | Disk: ${status.system.diskFreeGb}GB free`);
        console.log(`Queue Depth: ${status.dispatch.queueDepth} | Active Sandboxes: ${status.sandboxes}`);
      }
    } catch (err) {
      if (options.json) {
        console.log(JSON.stringify({ server: { status: "stopped" } }, null, 2));
      } else {
        console.log("Server: stopped");
      }
    }
  });
