/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A phase extracted from a plan.md body: a sequence number, a human title,
 * and a story-point estimate (0 when the plan declares none).
 */
export interface ExtractedPhase {
  seq: number;
  title: string;
  sp: number;
}

const SP_RE = /\(\s*(\d+)\s*SP\s*\)/i;

/** Strip the `(K SP)` marker, bold, and trailing separators from a raw title. */
function cleanTitle(raw: string): string {
  return raw
    .replace(SP_RE, "")
    .replace(/\*\*/g, "")
    .trim()
    .replace(/[—–:\-]+\s*$/, "")
    .trim();
}

/**
 * Extract implementation phases from a plan.md body.
 *
 * Recognizes two declaration forms and is deterministic (same input → same
 * output, sorted by seq, deduped by seq):
 *  - Headings: `## / ### / #### Phase N [—–:-] Title (K SP)`
 *  - List items that BEGIN with a phase declaration:
 *    `1. **Phase N — Title (K SP):**` or `- Phase N: Title (K SP)`
 *
 * It deliberately does NOT capture inline mentions ("(Phase 1)") inside table
 * cells or prose bullets — those carry no title or SP and would be noise.
 */
export function extractPhases(content: string): ExtractedPhase[] {
  const bySeq = new Map<number, ExtractedPhase>();

  const headingRe = /^#{2,4}\s+Phase\s+(\d+)\b(.*)$/i;
  const listRe = /^\s*(?:\d+\.|[-*])\s+\*{0,2}Phase\s+(\d+)\b(.*)$/i;

  for (const line of content.split("\n")) {
    const m = line.match(headingRe) ?? line.match(listRe);
    if (!m) continue;

    const seq = Number.parseInt(m[1], 10);
    // Remainder after "Phase N". Two title conventions:
    //  - dash form  "Phase N — Title (SP): description" → title is between the
    //    dash and the first ':' (which delimits the description).
    //  - colon form "Phase N: Title"                    → title is after ':'.
    const rest = m[2].trimStart();
    let titleRegion: string;
    if (/^[—–\-]/.test(rest)) {
      const afterDash = rest.replace(/^[—–\-]\s*/, "");
      const colon = afterDash.indexOf(":");
      titleRegion = colon >= 0 ? afterDash.slice(0, colon) : afterDash;
    } else if (rest.startsWith(":")) {
      titleRegion = rest.slice(1);
    } else {
      const colon = rest.indexOf(":");
      titleRegion = colon >= 0 ? rest.slice(0, colon) : rest;
    }

    const spMatch = titleRegion.match(SP_RE);
    const sp = spMatch ? Number.parseInt(spMatch[1], 10) : 0;
    const title = cleanTitle(titleRegion);

    // Dedupe by seq; first declaration (headings appear before later mentions
    // in well-formed plans, and doc order is preserved by this loop) wins.
    if (!bySeq.has(seq)) {
      bySeq.set(seq, { seq, title, sp });
    }
  }

  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}
