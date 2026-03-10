import fs from "node:fs";
import path from "node:path";
const DISPATCHES_FILE = ".gwrk/dispatches.jsonl";
export function persistDispatch(record) {
    const dir = path.dirname(DISPATCHES_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const line = `${JSON.stringify(record)}\n`;
    fs.appendFileSync(DISPATCHES_FILE, line, "utf8");
}
export function loadDispatches() {
    if (!fs.existsSync(DISPATCHES_FILE)) {
        return [];
    }
    const content = fs.readFileSync(DISPATCHES_FILE, "utf8");
    return content.split("\n")
        .filter(line => line.trim() !== "")
        .map(line => JSON.parse(line));
}
