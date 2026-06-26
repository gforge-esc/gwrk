#!/usr/bin/env node

import fs from "node:fs";
import { execSync } from "node:child_process";

const HEADER_BODY = `/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */`;

const HEADER_MARKER = "mozilla.org/MPL";

const files = process.argv.slice(2);
let changed = false;

for (const file of files) {
  if (!file.endsWith('.ts') && !file.endsWith('.tsx') && !file.endsWith('.js')) continue;
  
  try {
    const content = fs.readFileSync(file, "utf8");
    
    // Already has the MPL header — skip
    if (content.includes(HEADER_MARKER)) continue;

    // Handle shebang: #! must remain on line 1 (TypeScript TS18026)
    let result;
    if (content.startsWith("#!")) {
      const firstNewline = content.indexOf("\n");
      const shebang = content.substring(0, firstNewline + 1);
      const rest = content.substring(firstNewline + 1);
      result = shebang + HEADER_BODY + "\n\n" + rest;
    } else {
      result = HEADER_BODY + "\n\n" + content;
    }

    fs.writeFileSync(file, result, "utf8");
    // Stage the fix so the commit includes the header
    try {
      execSync(`git add "${file}"`);
    } catch (e) {
      // Ignore git add errors (e.g. if file is not in a git repo)
    }
    console.log(`[License] Added MPL-2.0 header to ${file}`);
    changed = true;
  } catch (err) {
    console.error(`[License] Error processing ${file}:`, err.message);
  }
}

if (changed) {
  console.log(`[License] Headers injected and staged.`);
}
