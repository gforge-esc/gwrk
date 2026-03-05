import { execFile, execFileSync } from "node:child_process";
export function execCommand(command, args, stdin) {
    return new Promise((resolve) => {
        const child = execFile(command, args, { encoding: "utf-8" }, (error, stdout, stderr) => {
            if (error) {
                const err = error;
                if (err.code === "ENOENT") {
                    resolve({
                        exitCode: 127,
                        stdout: "",
                        stderr: `Command not found: ${command}`,
                    });
                    return;
                }
                resolve({
                    exitCode: err.status ?? 1,
                    stdout: stdout.toString(),
                    stderr: stderr.toString(),
                });
            }
            else {
                resolve({
                    exitCode: 0,
                    stdout: stdout.toString(),
                    stderr: stderr.toString(),
                });
            }
        });
        if (stdin && child.stdin) {
            child.stdin.write(stdin);
            child.stdin.end();
        }
    });
}
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
    }
    catch (error) {
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
