import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { parse } from "yaml";
import { PluginLoader } from "../plugins/loader.js";
import { executeSkill } from "../plugins/skill-runtime.js";
import { color } from "../utils/format.js";
import { withSignal } from "../utils/signal.js";

const { BOLD, DIM, CYAN, GREEN, YELLOW, RED, MAGENTA, RESET } = color;

/**
 * FR-010: Synchronous skill scanner for help display.
 */
function getSkillsSync() {
  const globalBase = path.join(os.homedir(), ".gwrk", "plugins", "skills");
  // @ts-ignore
  const builtInBase = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "plugins",
    "builtins",
    "skills",
  );

  const skills: any[] = [];
  const visited = new Set<string>();

  const scan = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (visited.has(entry)) continue;
        const manifestPath = path.join(dir, entry, "manifest.yaml");
        if (fs.existsSync(manifestPath)) {
          try {
            const content = fs.readFileSync(manifestPath, "utf-8");
            const raw = parse(content);
            skills.push({
              name: raw.name || entry,
              tier: raw.tier || "atomic",
              description: raw.description || "",
            });
            visited.add(entry);
          } catch (e) {
            /* skip */
          }
        }
      }
    } catch (e) {
      /* skip */
    }
  };

  scan(globalBase);
  scan(builtInBase);
  return skills;
}

/**
 * FR-010: Help text for a specific skill.
 */
function getSkillManifestHelpSync(name: string): string {
  const loader = new PluginLoader();
  try {
    // resolvePlugin is async, but we need sync for help text.
    // We'll do a quick sync search.
    const globalPath = path.join(
      os.homedir(),
      ".gwrk",
      "plugins",
      "skills",
      name,
    );
    // @ts-ignore
    const builtInPath = path.join(
      path.dirname(new URL(import.meta.url).pathname),
      "..",
      "plugins",
      "builtins",
      "skills",
      name,
    );

    let manifestPath = "";
    if (fs.existsSync(path.join(globalPath, "manifest.yaml")))
      manifestPath = path.join(globalPath, "manifest.yaml");
    else if (fs.existsSync(path.join(builtInPath, "manifest.yaml")))
      manifestPath = path.join(builtInPath, "manifest.yaml");

    if (!manifestPath)
      return `\n${RED}Error:${RESET} Skill '${name}' not found.\n`;

    const content = fs.readFileSync(manifestPath, "utf-8");
    const m = parse(content);

    let out = `\n${BOLD}${CYAN}Skill: ${m.name}${RESET}\n`;
    out += `${DIM}${m.description}${RESET}\n\n`;
    out += `${BOLD}Tier:${RESET} ${m.tier}\n`;
    if (m.tier === "compound") {
      out += `${BOLD}Composes:${RESET} ${m.composes?.join(", ") || "none"}\n`;
    }
    out += `${BOLD}Preferred Agent:${RESET} ${m.runtime?.preferredAgent} (${m.runtime?.preferredModel})\n`;

    if (m.interface?.flags) {
      out += `\n${BOLD}Flags:${RESET}\n`;
      for (const f of m.interface.flags) {
        out += `  ${YELLOW}${f.name.padEnd(15)}${RESET} ${f.description || ""}\n`;
        if (f.values) out += `    Values: ${f.values.join(", ")}\n`;
      }
    }

    return out;
  } catch (e) {
    return `\n${RED}Error loading manifest for ${name}${RESET}\n`;
  }
}

/**
 * FR-006: gwrk skill <name> command handler.
 */
export const skillCommand = new Command("skill")
  .description("Invoke a reasoning skill")
  .argument("[name]", "Name of the skill to invoke")
  .option("--format <type>", "Output format (json)")
  .option("--agent", "Enable Agent-Native Mode (ANSI-stripped)", false)
  .addHelpText("after", () => {
    const argv = process.argv;
    const skillIdx = argv.indexOf("skill");
    const name = argv[skillIdx + 1];

    if (name && !name.startsWith("-")) {
      return getSkillManifestHelpSync(name);
    }

    const skills = getSkillsSync();
    const atomic = skills.filter((s) => s.tier === "atomic");
    const compound = skills.filter((s) => s.tier === "compound");

    let out = `\n${BOLD}${CYAN}Atomic Skills${RESET}\n`;
    for (const s of atomic) {
      out += `  ${GREEN}${s.name.padEnd(20)}${RESET} ${DIM}${s.description}${RESET}\n`;
    }

    out += `\n${BOLD}${CYAN}Compound Skills${RESET}\n`;
    for (const s of compound) {
      out += `  ${MAGENTA}${s.name.padEnd(20)}${RESET} ${DIM}${s.description}${RESET}\n`;
    }

    out += `\n${BOLD}Examples:${RESET}
  echo "brief.md" | gwrk skill narrative
  gwrk skill signal-cut < input.md --format json
  gwrk skill truth-extract --product gwrk

${BOLD}Type:${RESET} reasoning (invokes LLM)
${BOLD}Format:${RESET} inherits global --format and --agent flags
${BOLD}Exit codes:${RESET}
  0: Success
  1: Skill not found, dependency missing, or execution failed
  2: Usage error
`;
    return out;
  })
  .action(async (name, options, command) => {
    if (!name) {
      command.help();
      return;
    }

    await withSignal("skill", async () => {
      // Read stdin
      let input = "";
      if (!process.stdin.isTTY) {
        try {
          input = fs.readFileSync(0, "utf-8");
        } catch (e) {
          // Stdin might be empty or closed
        }
      }

      try {
        const result = await executeSkill(name, {
          input,
          format: options.format,
          agent: options.agent,
          ...options, // Pass extra flags from command line
        });

        // stdout is the skill result
        process.stdout.write(result.stdout);

        // stderr might have agent output, but no signal (we'll let withSignal do it)
        if (result.stderr) {
          process.stderr.write(result.stderr);
        }
      } catch (err: any) {
        if (err.stderr) {
          process.stderr.write(err.stderr);
        }
        if (err.message && !options.agent) {
          console.error(`${RED}Error:${RESET} ${err.message}`);
        }
        // withSignal will pick up this exitCode if we set it
        process.exitCode = err.exitCode || 1;
        throw err; // Re-throw so withSignal can report the error message if needed
      }
    });
  });
