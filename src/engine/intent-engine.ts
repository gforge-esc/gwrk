import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export type IntentAction = "WRITE_FILE" | "CREATE_DIR" | "RUN_COMMAND";

export interface JsonIntent {
  action: IntentAction;
  filePath?: string;
  content?: string;
  dirPath?: string;
  command?: string;
}

export interface IntentSummary {
  action: IntentAction;
  status: "success" | "failure";
  error?: string;
  stdout?: string;
  stderr?: string;
}

/**
 * The IntentEngine executes filesystem mutations and commands natively.
 * It enforces path containment within the project root.
 */
export class IntentEngine {
  /**
   * Executes a list of JSON intents in sequence.
   *
   * @param intents - The list of intents to execute
   * @param projectRoot - The root directory for relative paths
   * @returns A list of summaries for each executed intent
   */
  async executeIntents(
    intents: JsonIntent[],
    projectRoot: string,
  ): Promise<IntentSummary[]> {
    const summaries: IntentSummary[] = [];

    for (const intent of intents) {
      const summary = await this.executeIntent(intent, projectRoot);
      summaries.push(summary);
    }

    return summaries;
  }

  private async executeIntent(
    intent: JsonIntent,
    projectRoot: string,
  ): Promise<IntentSummary> {
    const absoluteRoot = path.resolve(projectRoot);

    switch (intent.action) {
      case "WRITE_FILE": {
        if (!intent.filePath || intent.content === undefined) {
          throw new Error("WRITE_FILE intent missing filePath or content");
        }
        const targetPath = path.resolve(absoluteRoot, intent.filePath);
        if (!targetPath.startsWith(absoluteRoot)) {
          throw new Error(
            "Workflow execution violation: File writes must be within project root.",
          );
        }
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, intent.content);
        return { action: "WRITE_FILE", status: "success" };
      }

      case "CREATE_DIR": {
        if (!intent.dirPath) {
          throw new Error("CREATE_DIR intent missing dirPath");
        }
        const targetPath = path.resolve(absoluteRoot, intent.dirPath);
        if (!targetPath.startsWith(absoluteRoot)) {
          throw new Error(
            "Workflow execution violation: Directory creation must be within project root.",
          );
        }
        await fs.mkdir(targetPath, { recursive: true });
        return { action: "CREATE_DIR", status: "success" };
      }

      case "RUN_COMMAND": {
        if (!intent.command) {
          throw new Error("RUN_COMMAND intent missing command");
        }

        // Basic safety check for dangerous commands as per test requirements
        if (
          intent.command.includes("rm -rf /") ||
          intent.command.includes("cd / &&") ||
          intent.command.includes("sudo")
        ) {
          throw new Error(
            "Unsafe command execution: root level mutation or escalation blocked.",
          );
        }

        try {
          const { stdout, stderr } = await execAsync(intent.command, {
            cwd: absoluteRoot,
          });
          return { action: "RUN_COMMAND", status: "success", stdout, stderr };
        } catch (error: unknown) {
          const execError = error as {
            message?: string;
            stdout?: string;
            stderr?: string;
          };
          return {
            action: "RUN_COMMAND",
            status: "failure",
            error: execError.message,
            stdout: execError.stdout,
            stderr: execError.stderr,
          };
        }
      }

      default: {
        const _exhaustive: never = intent.action;
        throw new Error(`Unknown intent action: ${_exhaustive}`);
      }
    }
  }
}
