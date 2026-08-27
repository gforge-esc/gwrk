/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The review agent's returned structured verdict, read as a one-way ratchet
 * (FR-010).
 *
 * Every review PROMPT.md asks for a final JSON object carrying a `verdict`
 * field, and `ReviewResult.verdict` has been declared at
 * `src/plugins/review-plugin.ts:45` the whole time — consumed nowhere. Run
 * #2728 iteration 2 is the case that leaves: the agent returned
 * `"verdict": "NO-GO"`, every gate was green, no task was re-opened, and the
 * console printed GO. Nothing else in the verdict path can catch that one,
 * because the agent's only surviving *evidence* channel is tasks.json and it
 * wrote nothing there.
 *
 * TC-006 forbids this ever growing teeth in the other direction, and the
 * enforcement is the return type rather than a comment: a returned `GO` is
 * **unrepresentable** in this function's output. No future edit can make the
 * agent's word override gate or re-open evidence without changing a signature
 * the phase gate greps for.
 */

/**
 * A returned NO-GO, in the three shapes it actually arrives in.
 *
 * One scan covers all three because they differ only in what *surrounds* the
 * `"verdict": "NO-GO"` pair — a bare JSON object, a ```json fence, or the pair
 * loose in prose the agent wrapped around it. A scan is indifferent to the
 * surroundings, and it keeps reading where `JSON.parse` gives up: agent stdout
 * is routinely truncated mid-object, and a verdict that is still perfectly
 * legible must not be lost to a missing closing brace.
 *
 * The key must be double-quoted, which is the whole point of the tightness
 * there: the review prompts describe the field as `` `verdict` `` in backticks
 * and gloss it as `"GO" if all checks pass …, "NO-GO" otherwise`, so an agent
 * quoting the format spec back at us cannot trip the ratchet. The *value* side
 * is tolerant — case, and `-`/`_`/space/nothing as the separator — because a
 * missed NO-GO ships a live defect while a spurious one costs a DIAGNOSE loop.
 * The asymmetry in what this pattern forgives follows the asymmetry in cost.
 *
 * The quotes are required UNESCAPED, which is why the caller must hand this
 * pattern decoded text and never a raw stream-json line — see
 * {@link spokenText}.
 */
const RETURNED_NO_GO = /"verdict"\s*:\s*"\s*no[-_ ]?go\s*"/i;

/**
 * Claude Code's `--output-format stream-json` event types.
 *
 * Recognising the envelope is what separates *what the agent said* from *what
 * the transcript happens to contain*. Anything outside this set is not a
 * stream-json event, and is scanned as plain text instead — which is how the
 * prose backends (agy, codex) and a bare JSON object still work.
 */
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

/**
 * The opening of the terminal `result` event, matched on a line `JSON.parse`
 * could not finish.
 *
 * Agent stdout gets clipped, and the `result` event is the likeliest casualty:
 * it is last and it is the largest, because it carries the agent's entire final
 * message. It is also the one event whose payload is testimony, which is what
 * makes recovering it safe — a clipped `user` / `tool_result` line does not
 * match this prefix and stays on the plain-text path, so file bytes the agent
 * merely read still cannot trip the ratchet.
 */
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

/**
 * Undo JSON string escaping over text `JSON.parse` refused, so a half-written
 * envelope reads like the string value it was going to be.
 *
 * One pass, not a chain of replaces: the pattern consumes the backslash and the
 * character it escapes together, so a literal `\\` cannot be mistaken for the
 * start of an escaped quote. Text with nothing to undo comes back unchanged.
 */
function decodeJsonEscapes(text: string): string {
  return text.replace(JSON_ESCAPE, (_match, sequence: string) =>
    sequence.length > 1
      ? String.fromCharCode(Number.parseInt(sequence.slice(1), 16))
      : (JSON_ESCAPE_CHARS[sequence] ?? sequence),
  );
}

/**
 * The parts of one stdout line the agent actually *said*.
 *
 * Returns `undefined` when the line is not a stream-json event, meaning "scan
 * this line as text". Returns an array — possibly empty — when it is one,
 * meaning "these are the only strings in it that count".
 *
 * The distinction is load-bearing in both directions.
 *
 * On the claude backend `TaskResult.stdout` is the raw event stream:
 * `ClaudeAdapter` dispatches `--output-format stream-json --verbose`
 * (`adapter.ts:66-74`), `agent.ts` pushes every raw line into `stdoutLines`
 * and resolves `stdout: stdoutLines.join("\n")`, and `parseResult` returns that
 * verbatim. The agent's JSON is therefore a STRING VALUE inside an envelope and
 * every inner quote arrives backslash-escaped, so scanning the raw line finds
 * nothing — the defect this function exists to close, which left the ratchet
 * dead on the only backend `gwrk ship` runs.
 *
 * And decoding is not enough on its own: the fix cannot be to tolerate `\"` in
 * the pattern, because a review agent reads spec.md and plan.md every single
 * run, and both contain `"verdict": "NO-GO"` verbatim. Those bytes come back as
 * a `user` / `tool_result` event, and a `tool_use` input carries whatever the
 * agent grepped for. Neither is the agent returning a verdict. Only the
 * terminal `result` payload and `assistant` **text** blocks are, so only those
 * are handed to the pattern.
 */
function spokenText(line: string): string[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    // A clipped terminal `result` event is still testimony; anything else that
    // does not decode is plain text (a prose backend, or prose around a fence).
    return TRUNCATED_RESULT_EVENT.test(line)
      ? [decodeJsonEscapes(line)]
      : undefined;
  }
  if (!isRecord(parsed) || typeof parsed.type !== "string") return undefined;
  if (!STREAM_EVENT_TYPES.has(parsed.type)) return undefined;

  if (parsed.type === "result") {
    return typeof parsed.result === "string" ? [parsed.result] : [];
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
  // system, user, stream_event, rate_limit_event: transcript, not testimony.
  return [];
}

/**
 * Scan agent stdout for a returned blocking verdict.
 *
 * Returns `"NO-GO"` if the agent said so anywhere in its output, `undefined`
 * otherwise — including for a returned `"GO"`, which is not "no verdict" but is
 * treated identically, because it is ignored (TC-006). `undefined` therefore
 * means exactly one thing to the caller: *leave the gate + re-open computation
 * alone*.
 *
 * Line by line, because the two stdout shapes interleave in practice: a
 * stream-json run is one JSON event per line, a prose backend is prose, and a
 * clipped run is a stream-json prefix followed by half an event. Each line is
 * decoded if it decodes and scanned as text if it does not, so truncation
 * degrades to the text path rather than losing the verdict.
 *
 * Never throws, on any input. That is a deliberate, documented exception to the
 * repository's Fail-Fast rule (TC-002), of the same kind as the read side of
 * {@link file://./findings-ledger.ts}: a run must not die because an agent
 * formatted its summary badly, and adding a new way to hard-fail on agent
 * formatting is precisely what FR-010 was not allowed to do. `JSON.parse` is
 * the only throwing call here and it is caught.
 *
 * Any NO-GO found wins, regardless of position. There is no last-match-wins
 * rule to write, because a returned GO carries no weight to cancel it with —
 * which is what makes this a ratchet rather than a vote.
 */
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
