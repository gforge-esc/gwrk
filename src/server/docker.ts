/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execSync } from "node:child_process";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

/**
 * Check if Docker CLI is installed on the system.
 */
function isDockerInstalled(): boolean {
  try {
    execSync("which docker", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if Docker daemon is running and responsive.
 */
function isDockerRunning(): boolean {
  try {
    execSync("docker info", { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Attempt to start Docker Desktop (macOS).
 * Returns true if the launch command succeeded.
 */
function startDockerDesktop(): boolean {
  try {
    execSync("open -a Docker", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for the Docker daemon to become responsive.
 * Polls every `intervalMs` up to `timeoutMs`.
 */
async function waitForDocker(
  timeoutMs = 30_000,
  intervalMs = 2_000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isDockerRunning()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

interface DockerStatus {
  installed: boolean;
  running: boolean;
  startedByUs: boolean;
}

/**
 * Ensure Docker is available and running.
 *
 * 1. Check if Docker CLI is installed → fail with install instructions if not.
 * 2. Check if daemon is running → return immediately if yes.
 * 3. Attempt to start Docker Desktop (macOS) → wait up to 30s for daemon.
 * 4. If still not running → fail with actionable guidance.
 */
async function ensureDocker(): Promise<DockerStatus> {
  // Step 1: Is Docker installed?
  if (!isDockerInstalled()) {
    console.error("");
    console.error(`  ${RED}✗${RESET} Docker is not installed.`);
    console.error("");
    console.error("  Install Docker Desktop:");
    console.error(`    ${BOLD}brew install --cask docker${RESET}`);
    console.error("  or download from:");
    console.error(
      `    ${DIM}https://www.docker.com/products/docker-desktop/${RESET}`,
    );
    console.error("");
    process.exit(1);
  }

  // Step 2: Is daemon already running?
  if (isDockerRunning()) {
    return { installed: true, running: true, startedByUs: false };
  }

  // Step 3: Try to start Docker Desktop
  console.error(
    `  ${YELLOW}⏳${RESET} Docker daemon not running. Starting Docker Desktop...`,
  );

  if (!startDockerDesktop()) {
    console.error(`  ${RED}✗${RESET} Could not launch Docker Desktop.`);
    console.error("");
    console.error("  Start it manually:");
    console.error(`    ${BOLD}open -a Docker${RESET}`);
    console.error("");
    process.exit(1);
  }

  // Step 4: Wait for daemon
  const ready = await waitForDocker(30_000, 2_000);

  if (!ready) {
    console.error(
      `  ${RED}✗${RESET} Docker Desktop started but daemon is not responding.`,
    );
    console.error("");
    console.error("  Try restarting Docker Desktop:");
    console.error(
      `    ${BOLD}osascript -e 'quit app "Docker"' && open -a Docker${RESET}`,
    );
    console.error("");
    process.exit(1);
  }

  console.error(`  ${GREEN}✓${RESET} Docker Desktop started`);
  return { installed: true, running: true, startedByUs: true };
}
