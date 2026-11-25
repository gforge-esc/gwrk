#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { executeOperatorNativeProof } from "./native-evidence/operator-execution.mjs";
import { verifyNativeEvidence } from "./native-evidence/verifier.mjs";

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--execute-native") {
      options.executeNative = true;
    } else if (arg === "--checkpoint") {
      if (i + 1 >= args.length) {
        process.stderr.write("Error: --checkpoint requires an argument\n");
        process.exit(1);
      }
      options.checkpointPath = args[++i];
    } else if (arg === "--trust-anchor-sha256") {
      if (i + 1 >= args.length) {
        process.stderr.write(
          "Error: --trust-anchor-sha256 requires an argument\n",
        );
        process.exit(1);
      }
      options.trustAnchorSha256 = args[++i];
    } else if (arg === "--grep") {
      if (i + 1 >= args.length) {
        process.stderr.write("Error: --grep requires an argument\n");
        process.exit(1);
      }
      options.grep = args[++i];
    } else if (arg === "--repo-root") {
      if (i + 1 >= args.length) {
        process.stderr.write("Error: --repo-root requires an argument\n");
        process.exit(1);
      }
      options.repoRoot = args[++i];
    } else if (arg === "--anchor") {
      if (i + 1 >= args.length) {
        process.stderr.write("Error: --anchor requires an argument\n");
        process.exit(1);
      }
      options.trustAnchorPath = args[++i];
    } else if (arg === "--envelope") {
      if (i + 1 >= args.length) {
        process.stderr.write("Error: --envelope requires an argument\n");
        process.exit(1);
      }
      options.envelopePath = args[++i];
    } else if (arg === "--signature") {
      if (i + 1 >= args.length) {
        process.stderr.write("Error: --signature requires an argument\n");
        process.exit(1);
      }
      options.signaturePath = args[++i];
    } else {
      process.stderr.write(`Error: Unknown or malformed flag: ${arg}\n`);
      process.exit(1);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.executeNative) {
    try {
      const outcome = await executeOperatorNativeProof({
        checkpointPath: options.checkpointPath,
        repoRoot: options.repoRoot,
        trustAnchorPath: options.trustAnchorPath,
        trustAnchorSha256: options.trustAnchorSha256,
      });
      process.stdout.write(
        `${JSON.stringify({
          event: "operator_native_proof_completed",
          runId: outcome.runId,
          nativeSuiteStatus: outcome.nativeSuiteStatus,
          livePilotAcceptance: outcome.livePilotAcceptance,
          unsignedBundlePath: outcome.unsignedBundlePath,
          canonicalEnvelopePath: outcome.canonicalEnvelopePath,
        })}\n`,
      );
      process.exit(0);
    } catch (error) {
      process.stderr.write(
        `Native operator execution failed: ${error.message}\n`,
      );
      process.exit(1);
    }
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

    if (options.grep && matchingCases.length === 0) {
      process.stderr.write(
        `Error: No pilot cases matched grep pattern '${options.grep}'.\n`,
      );
      process.exit(1);
    }

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
