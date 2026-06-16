#!/usr/bin/env node

import fs from "node:fs";
import { execSync } from "node:child_process";

const HEADER = `/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

`;

const files = process.argv.slice(2);
let changed = false;

for (const file of files) {
  if (!file.endsWith('.ts') && !file.endsWith('.tsx') && !file.endsWith('.js')) continue;
  
  try {
    const content = fs.readFileSync(file, "utf8");
    
    // Check if the file already has the MPL header
    if (!content.includes("Mozilla Public License, v. 2.0")) {
      fs.writeFileSync(file, HEADER + content, "utf8");
      // If this is running during a pre-commit hook, we should automatically stage the fix
      try {
        execSync(`git add "${file}"`);
      } catch (e) {
        // Ignore git add errors (e.g. if file is not in a git repo)
      }
      console.log(`[License] Added MPL-2.0 header to ${file}`);
      changed = true;
    }
  } catch (err) {
    console.error(`[License] Error processing ${file}:`, err.message);
  }
}

if (changed) {
  console.log(`[License] Headers injected and staged.`);
}
