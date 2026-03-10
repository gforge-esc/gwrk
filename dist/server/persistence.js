import * as fs from "node:fs";
import * as path from "node:path";
/**
 * Appends a dispatch record to the persistent .gwrk/dispatches.jsonl log in the project root.
 * Creates the directory and file if they do not exist.
 */
export function persistDispatch(record, projectRoot = process.cwd()) {
    const gwrkDir = path.join(projectRoot, ".gwrk");
    const dispatchesFile = path.join(gwrkDir, "dispatches.jsonl");
    if (!fs.existsSync(gwrkDir)) {
        fs.mkdirSync(gwrkDir, { recursive: true });
    }
    const line = `${JSON.stringify(record)}\n`;
    fs.appendFileSync(dispatchesFile, line, "utf-8");
}
