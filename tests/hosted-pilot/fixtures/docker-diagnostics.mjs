import { createHash } from "node:crypto";

// CLI output can contain reflected arguments. Persist only bounded static details
// and a digest of stderr, never arbitrary daemon messages or environment values.
export function classifyDockerFailure(command, result) {
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  const candidates = [
    [
      /--pid:\s*invalid PID mode/i,
      "invalid_pid_mode",
      "Docker rejected the PID namespace option",
    ],
    [
      /unknown flag/i,
      "unsupported_option",
      "Docker rejected an unsupported command option",
    ],
    [
      /no such image|pull access denied|image.*not found/i,
      "preload_image_unavailable",
      "A required preloaded image is unavailable",
    ],
    [
      /invalid mount|bind source path does not exist|error while creating mount source path/i,
      "fixture_mount_unavailable",
      "An owned fixture mount is unavailable",
    ],
    [
      /cannot connect.*docker daemon|failed to connect to the docker API|error during connect/i,
      "daemon_unavailable",
      "The selected Docker daemon is unavailable",
    ],
  ];
  const match = candidates.find(([pattern]) => pattern.test(stderr));
  return {
    operation: command === "create" ? "create" : "other",
    exitCode: Number.isInteger(result.code) ? result.code : null,
    category: match?.[1] ?? "docker_command_failed",
    detail:
      match?.[2] ??
      "Docker command failed without a recognized safe diagnostic",
    stderrBytes: Buffer.byteLength(stderr),
    stderrSha256: createHash("sha256").update(stderr).digest("hex"),
  };
}
