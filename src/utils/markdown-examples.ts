/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export function maskPromptExamples(template: string): string {
  // Keep offsets and line endings without turning quoted content into whitespace.
  const mask = (code: string) => code.replace(/[^\r\n]/g, "\0");
  const maskSpans = (text: string) =>
    text
      .replace(/^ {0,3}>[^\r\n]*/gm, mask)
      .replace(
        /^(?: {4}| {0,3}\t)[^\r\n]*(?:\r?\n(?:[ \t]*\r?\n)*(?: {4}| {0,3}\t)[^\r\n]*)*/gm,
        (block, offset: number, text: string) =>
          block.trim() === "{{enforcement}}" ||
          (block.trimEnd().endsWith("{{enforcement}}") &&
            /^\r?\n<\/code_quality>/.test(text.slice(offset + block.length)))
            ? block
            : mask(block),
      )
      .split(/(\r?\n[ \t]*\r?\n)/)
      .map((paragraph) =>
        paragraph.replace(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, mask),
      )
      .join("");

  let masked = "";
  let textStart = 0;
  let fence: { delimiter: string; start: number } | undefined;
  const blocks = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)|<!--/gm;
  for (
    let block = blocks.exec(template);
    block;
    block = blocks.exec(template)
  ) {
    const [line, delimiter, rest] = block;
    const { index } = block;
    if (line === "<!--") {
      if (fence) continue;
      const closer = template.indexOf("-->", index + line.length);
      if (closer === -1) continue;
      const lineEnd = template.indexOf("\n", closer);
      const visible = maskSpans(
        template.slice(textStart, lineEnd === -1 ? template.length : lineEnd),
      );
      if (!visible.startsWith(line, index - textStart)) continue;

      const end = closer + "-->".length;
      masked += maskSpans(template.slice(textStart, index));
      masked += mask(template.slice(index, end));
      textStart = end;
      blocks.lastIndex = end;
    } else if (!fence) {
      if (delimiter[0] === "`" && rest.includes("`")) continue;
      masked += maskSpans(template.slice(textStart, index));
      fence = { delimiter, start: index };
    } else if (
      delimiter[0] === fence.delimiter[0] &&
      delimiter.length >= fence.delimiter.length &&
      !rest.trim()
    ) {
      textStart = index + line.length;
      masked += mask(template.slice(fence.start, textStart));
      fence = undefined;
    }
  }
  return (
    masked +
    (fence
      ? mask(template.slice(fence.start))
      : maskSpans(template.slice(textStart)))
  );
}
