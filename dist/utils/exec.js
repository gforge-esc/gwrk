import { execFile, execFileSync, spawn } from "node:child_process";
/**
 * Run a command with streaming output (stdio: inherit by default).
 * Returns a promise that resolves on success or rejects with exit code.
 */
export function run(command, args, opts) {
    return new Promise((resolve, reject) => {
        let stdio = opts?.stdio ?? "inherit";
        if (opts?.input && stdio === "inherit") {
            stdio = ["pipe", "inherit", "inherit"];
        }
        const child = spawn(command, args, {
            cwd: opts?.cwd,
            env: opts?.env ?? process.env,
            stdio,
        });
        if (opts?.input && child.stdin) {
            child.stdin.write(opts.input);
            child.stdin.end();
        }
        child.on("close", (code) => {
            if (code === 0) {
                resolve();
            }
            else {
                const err = new Error(`Process exited with code ${code}`);
                err.exitCode = code ?? 1;
                reject(err);
            }
        });
        child.on("error", (err) => {
            reject(err);
        });
    });
}
export function execCommand(command, args, stdin, opts) {
    return new Promise((resolve) => {
        const child = execFile(command, args, {
            encoding: "utf-8",
            cwd: opts?.cwd,
            env: opts?.env ?? process.env,
        }, (error, stdout, stderr) => {
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
