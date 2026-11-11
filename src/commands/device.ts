/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Command } from "commander";
import { logCliOutput } from "../adapters/cli/output-scope.js";
import { isPidRunning, readPid } from "../server/pid.js";
import { loadDevice } from "../utils/device.js";
import { CommandError, withSignal } from "../utils/signal.js";

export const createDeviceCommand = () =>
  new Command("device")
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
        logCliOutput();
        logCliOutput(`  Device:   ${device.id.slice(0, 8)}`);
        logCliOutput(`  Hostname: ${device.hostname}`);
        logCliOutput(`  Role:     ${device.role}`);
        logCliOutput(`  Since:    ${since}`);
        logCliOutput();

        if (device.role === "server") {
          const pid = readPid();
          const running = pid ? isPidRunning(pid) : false;
          if (running) {
            logCliOutput(`  Daemon:   running (pid ${pid})`);
          } else {
            logCliOutput("  Daemon:   not running");
          }
          logCliOutput("  Features: harvest, Slack, heartbeat, dispatch");
        } else {
          logCliOutput(
            "  Agent work runs locally. Harvest handled by the server via GitHub.",
          );
          logCliOutput("  To switch roles: gwrk init --server");
        }
        logCliOutput();
      });
    });

export const deviceCommand = createDeviceCommand();
