import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function findShellScripts(dir: string, fileList: string[] = []): string[] {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      findShellScripts(filePath, fileList);
    } else if (filePath.endsWith(".sh")) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

describe("Shell Scripts Syntax Check", () => {
  const scriptsDir = path.join(process.cwd(), "scripts");
  const scripts = fs.existsSync(scriptsDir) ? findShellScripts(scriptsDir) : [];

  it.each(scripts)("%s should have valid bash syntax", (scriptPath: string) => {
    try {
      // `bash -n` performs a syntax check without executing the script
      execFileSync("bash", ["-n", scriptPath], {
        stdio: "pipe",
        encoding: "utf-8",
      });
    } catch (err: unknown) {
      if (err instanceof Error && "stderr" in err) {
        throw new Error(`Syntax error in ${scriptPath}:\n${err.stderr}`);
      }
      throw err;
    }
    expect(true).toBe(true);
  });
});
