#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { verifyNativeEvidence } from "./native-evidence/verifier.ts";

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--execute-native") {
      options.executeNative = true;
    } else if (arg === "--grep" && i + 1 < args.length) {
      options.grep = args[++i];
    } else if (arg === "--repo-root" && i + 1 < args.length) {
      options.repoRoot = args[++i];
    } else if (arg === "--anchor" && i + 1 < args.length) {
      options.trustAnchorPath = args[++i];
    } else if (arg === "--envelope" && i + 1 < args.length) {
      options.envelopePath = args[++i];
    } else if (arg === "--signature" && i + 1 < args.length) {
      options.signaturePath = args[++i];
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.executeNative) {
    process.stderr.write(
      "Error: --execute-native is unavailable in this component until the separately reviewed execution adapter is connected.\n",
    );
    process.exit(1);
  }

  try {
    const result = await verifyNativeEvidence({
      repoRoot: options.repoRoot,
      trustAnchorPath: options.trustAnchorPath,
      envelopePath: options.envelopePath,
      signaturePath: options.signaturePath,
    });

    const cases = result.envelope.executionProof.pilotProof.cases;
    const grep = options.grep ? new RegExp(options.grep, "i") : null;
    const matchingCases = grep ? cases.filter((c) => grep.test(c)) : cases;

    process.stdout.write(
      `Verified native evidence envelope (${result.envelope.executionProof.runId}).\n`,
    );
    for (const item of matchingCases) {
      process.stdout.write(` - verified case: ${item}\n`);
    }

    process.exit(0);
  } catch (error) {
    process.stderr.write(
      `Native evidence verification failed: ${error.message}\n`,
    );
    process.exit(1);
  }
}

main();
