import { execFileSync } from "node:child_process";
export function runGate(gateScript) {
  try {
    const stdout = execFileSync(gateScript, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      exitCode: 0,
      stdout: stdout.toString(),
      stderr: "",
    };
  } catch (error) {
    const err = error;
    if (err.code === "ENOENT") {
      return {
        exitCode: 127,
        stdout: "",
        stderr: `Gate script not found: ${gateScript}`,
      };
    }
    return {
      exitCode: err.status ?? 1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
    };
  }
}
