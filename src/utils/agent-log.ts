/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Renders Claude Code `--output-format stream-json` events into a readable
 * run transcript for the .runs/*.log file.
 *
 * The rendered log is the human/agent-facing view: long tool outputs are
 * truncated for readability. The complete, lossless stream is mirrored to a
 * .jsonl sidecar by the caller, so nothing is actually lost — the transcript
 * is for review, the sidecar is for exhaustive debugging.
 */

/** Longest tool-result preview kept in the rendered transcript. */
const MAX_RESULT_PREVIEW = 1500;
/** Longest tool-input summary (e.g. a Bash command) kept inline. */
const MAX_INPUT_SUMMARY = 300;

interface StreamContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
}

interface StreamEvent {
  type?: string;
  subtype?: string;
  model?: string;
  message?: { role?: string; content?: unknown };
  result?: unknown;
  is_error?: boolean;
  duration_ms?: number;
  num_turns?: number;
  total_cost_usd?: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** "851000" → "14m 11s"; "5000" → "5s". */
function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… (truncated, full output in .jsonl)`;
}

/** Flatten a tool_result `content` (string or array of text blocks) to a string. */
function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (isRecord(b) && typeof b.text === "string" ? b.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** Compact, tool-aware one-line summary of a tool_use input. */
function summarizeToolInput(name: string, input: unknown): string {
  if (!isRecord(input)) return "";
  const filePath =
    typeof input.file_path === "string" ? input.file_path : undefined;
  switch (name) {
    case "Bash": {
      const cmd = typeof input.command === "string" ? input.command : "";
      return truncate(cmd.replace(/\s*\n\s*/g, " ⏎ "), MAX_INPUT_SUMMARY);
    }
    case "Write": {
      const len = typeof input.content === "string" ? input.content.length : 0;
      return `${filePath ?? "?"} (${len} chars)`;
    }
    case "Edit":
      return `${filePath ?? "?"} (edit)`;
    case "MultiEdit": {
      const n = Array.isArray(input.edits) ? input.edits.length : 0;
      return `${filePath ?? "?"} (${n} edits)`;
    }
    case "Read":
      return filePath ?? "?";
    case "Glob":
    case "Grep":
      return typeof input.pattern === "string" ? input.pattern : "";
    default: {
      const json = JSON.stringify(input);
      return truncate(json, MAX_INPUT_SUMMARY);
    }
  }
}

function renderAssistant(content: unknown): string | null {
  const blocks: StreamContentBlock[] = Array.isArray(content)
    ? (content as StreamContentBlock[])
    : typeof content === "string"
      ? [{ type: "text", text: content }]
      : [];
  const lines: string[] = [];
  for (const block of blocks) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string") {
      if (block.text.trim()) lines.push(`● ${block.text.trim()}`);
    } else if (
      block.type === "thinking" &&
      typeof block.thinking === "string"
    ) {
      lines.push(
        `· thinking: ${truncate(block.thinking.trim(), MAX_RESULT_PREVIEW)}`,
      );
    } else if (block.type === "tool_use" && typeof block.name === "string") {
      lines.push(
        `🔧 ${block.name}: ${summarizeToolInput(block.name, block.input)}`,
      );
    }
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

function renderToolResults(content: unknown): string | null {
  const blocks: StreamContentBlock[] = Array.isArray(content)
    ? (content as StreamContentBlock[])
    : [];
  const lines: string[] = [];
  for (const block of blocks) {
    if (!isRecord(block) || block.type !== "tool_result") continue;
    const preview = truncate(
      flattenContent(block.content).trim(),
      MAX_RESULT_PREVIEW,
    );
    const mark = block.is_error ? "✗ " : "";
    // Align continuation lines under the ↳ marker so multi-line tool output
    // stays readable in the transcript.
    const body = preview
      .split("\n")
      .map((l, i) => (i === 0 ? l : `    ${l}`))
      .join("\n");
    lines.push(`  ↳ ${mark}${body}`);
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

function renderResult(evt: StreamEvent): string {
  const glyph = evt.is_error ? "✗" : "✓";
  const label = evt.subtype ?? (evt.is_error ? "error" : "done");
  const parts = [`${glyph} ${label}`];
  if (typeof evt.num_turns === "number") parts.push(`${evt.num_turns} turns`);
  if (typeof evt.duration_ms === "number")
    parts.push(formatDuration(evt.duration_ms));
  if (typeof evt.total_cost_usd === "number")
    parts.push(`$${evt.total_cost_usd}`);
  return parts.join(" · ");
}

/**
 * Render one stream-json event to a transcript line (or multi-line string).
 * Returns null when the event carries nothing worth rendering or is an
 * unrecognized shape — the caller then falls back to writing the raw line so
 * no information is silently dropped.
 */
export function renderStreamEvent(evt: unknown): string | null {
  if (!isRecord(evt) || typeof evt.type !== "string") return null;
  const e = evt as StreamEvent;
  switch (e.type) {
    case "system": {
      const parts = ["▸ session"];
      if (e.subtype) parts.push(e.subtype);
      if (e.model) parts.push(`model=${e.model}`);
      return parts.join(" · ");
    }
    case "assistant":
      return renderAssistant(e.message?.content);
    case "user":
      return renderToolResults(e.message?.content);
    case "result":
      return renderResult(e);
    default:
      return null;
  }
}

export interface RenderedStdoutLine {
  /** Exact raw line to append to the lossless .jsonl sidecar. */
  jsonl: string;
  /** Text to append to the readable .log transcript (rendered, or raw fallback). */
  log: string;
  /** The parsed terminal `result` event, when this line was one. */
  resultEvent?: unknown;
}

/**
 * Route one stdout line from a stream-json backend to its two destinations:
 * the lossless sidecar (always the raw line) and the readable transcript
 * (the rendered event, or the raw line when it isn't a recognized event, so
 * nothing is silently dropped). Also surfaces the terminal result event.
 *
 * Pure and side-effect-free — the caller owns the actual stream writes.
 */
export function renderStreamStdoutLine(line: string): RenderedStdoutLine {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { jsonl: line, log: line };
  }
  const resultEvent =
    isRecord(parsed) && parsed.type === "result" ? parsed : undefined;
  const rendered = renderStreamEvent(parsed);
  return { jsonl: line, log: rendered ?? line, resultEvent };
}

/**
 * When a run's terminal `result` event indicates failure, produce a concise
 * one-line summary for the CLI (goal: surface errors + helpful context without
 * dumping the whole transcript). Returns null for success or non-result events.
 */
export function formatResultError(evt: unknown): string | null {
  if (!isRecord(evt) || evt.type !== "result" || !evt.is_error) return null;
  const subtype = typeof evt.subtype === "string" ? evt.subtype : "error";
  const resultText = typeof evt.result === "string" ? evt.result : "";
  const firstLine = resultText.split("\n")[0]?.trim();
  return firstLine
    ? `${subtype}: ${truncate(firstLine, MAX_INPUT_SUMMARY)}`
    : subtype;
}
