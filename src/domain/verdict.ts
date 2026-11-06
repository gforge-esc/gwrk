/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const RETURNED_NO_GO = /"verdict"\s*:\s*"\s*no[-_ ]?go\s*"/i;

const STREAM_EVENT_TYPES = new Set([
  "system",
  "assistant",
  "user",
  "result",
  "stream_event",
  "rate_limit_event",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const TRUNCATED_RESULT_EVENT = /^\s*\{\s*"type"\s*:\s*"result"/;

const JSON_ESCAPE = /\\(["\\/bfnrt]|u[0-9a-fA-F]{4})/g;
const JSON_ESCAPE_CHARS: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

function decodeJsonEscapes(text: string): string {
  return text.replace(JSON_ESCAPE, (_match, sequence: string) =>
    sequence.length > 1
      ? String.fromCharCode(Number.parseInt(sequence.slice(1), 16))
      : (JSON_ESCAPE_CHARS[sequence] ?? sequence),
  );
}

function spokenText(line: string): string[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return TRUNCATED_RESULT_EVENT.test(line)
      ? [decodeJsonEscapes(line)]
      : undefined;
  }
  if (!isRecord(parsed) || typeof parsed.type !== "string") return undefined;
  if (!STREAM_EVENT_TYPES.has(parsed.type)) return undefined;

  if (parsed.type === "result") {
    const out: string[] = [];
    if (typeof parsed.result === "string") out.push(parsed.result);
    if (isRecord(parsed.structured_output)) {
      out.push(JSON.stringify(parsed.structured_output));
    }
    return out;
  }
  if (parsed.type === "assistant") {
    const message = parsed.message;
    if (!isRecord(message) || !Array.isArray(message.content)) return [];
    return message.content
      .filter(
        (block): block is Record<string, unknown> =>
          isRecord(block) && block.type === "text",
      )
      .map((block) => (typeof block.text === "string" ? block.text : ""));
  }
  return [];
}

export function parseReturnedVerdict(stdout: string): "NO-GO" | undefined {
  if (typeof stdout !== "string" || stdout.length === 0) return undefined;

  for (const line of stdout.split("\n")) {
    if (line.length === 0) continue;
    for (const said of spokenText(line) ?? [line]) {
      if (RETURNED_NO_GO.test(said)) return "NO-GO";
    }
  }
  return undefined;
}
