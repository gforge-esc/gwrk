/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Command } from "commander";
import { loadDevice } from "../utils/device.js";
import { readPid, isPidRunning } from "../server/pid.js";
import { withSignal, CommandError } from "../utils/signal.js";

export const deviceCommand = new Command("device")
  .description("Show device identity and role")
  .action(async () => {
    await withSignal("device", async () => {
      const device = loadDevice();
      if (!device) {
        throw new CommandError(
          "No device registered. Run 'gwrk init' first.",
          1,
        );
      }

      const since = device.createdAt.split("T")[0];
      console.log();
      console.log(`  Device:   ${device.id.slice(0, 8)}`);
      console.log(`  Hostname: ${device.hostname}`);
      console.log(`  Role:     ${device.role}`);
      console.log(`  Since:    ${since}`);
      console.log();

      if (device.role === "server") {
        const pid = readPid();
        const running = pid ? isPidRunning(pid) : false;
        if (running) {
          console.log(`  Daemon:   running (pid ${pid})`);
        } else {
          console.log("  Daemon:   not running");
        }
        console.log("  Features: harvest, Slack, heartbeat, dispatch");
      } else {
        console.log(
          "  Agent work runs locally. Harvest handled by the server via GitHub.",
        );
        console.log("  To switch roles: gwrk init --server");
      }
      console.log();
    });
  });
