import fs from "node:fs";
import path from "node:path";
const PID_FILE = ".gwrk/server.pid";
export function writePid(pid) {
    const dir = path.dirname(PID_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(PID_FILE, pid.toString(), "utf8");
}
export function readPid() {
    if (!fs.existsSync(PID_FILE)) {
        return undefined;
    }
    const content = fs.readFileSync(PID_FILE, "utf8").trim();
    const pid = Number.parseInt(content, 10);
    return Number.isNaN(pid) ? undefined : pid;
}
export function removePid() {
    if (fs.existsSync(PID_FILE)) {
        fs.unlinkSync(PID_FILE);
    }
}
export function isPidRunning(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
