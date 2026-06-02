# Agent CLI "YOLO" Commands

This reference outlines the exact command formats for invoking the `claude`, `gemini`, and `codex` CLIs in non-interactive (headless) "YOLO" mode—where they accept actions automatically—targeted at a specific model.

## Claude

Claude Code's headless/non-interactive mode uses the `-p` (or `--print`) flag. YOLO mode is approximated by completely bypassing permission checks.

```bash
claude --dangerously-skip-permissions --model <model> -p "<prompt>"
```
- `-p, --print`: Print response and exit (non-interactive).
- `--model <model>`: Specify model (e.g., `sonnet`, `opus`).
- `--dangerously-skip-permissions`: Bypass all permission checks for actions.

## Gemini

The Gemini CLI uses `-p` (or `--prompt`) for headless mode and has an explicit YOLO flag.

```bash
gemini --yolo --model <model> -p "<prompt>"
```
- `-p <prompt>, --prompt <prompt>`: Run in non-interactive mode.
- `-m <model>, --model <model>`: Specify model.
- `-y, --yolo`: Automatically accept all actions (YOLO mode).

## Codex

The Codex CLI has an `exec` subcommand for non-interactive execution and explicit danger flags for bypassing sandbox execution blocks.

```bash
codex exec --dangerously-bypass-approvals-and-sandbox --model <MODEL> "<prompt>"
```
- `exec`: Run non-interactively.
- `--model <MODEL>`: Specify model.
- `--dangerously-bypass-approvals-and-sandbox`: Skips all confirmation prompts and executes commands without sandboxing.
    - *Alternative (Sandboxed but auto)*: `-a never` (Never ask for approval).
