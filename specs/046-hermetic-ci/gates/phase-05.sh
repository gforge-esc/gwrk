#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
# AUTHORED

set -euo pipefail
export GIT_NO_LAZY_FETCH=1
cd "$(git rev-parse --show-toplevel)"

feature=specs/046-hermetic-ci
evidence="$feature/evidence/blocking-lint-hosted.md"
tested_sha=$(node - "$evidence" <<'NODE'
const { readFileSync } = require("node:fs");

function fail(message) {
  console.error(`Hosted lint receipt: ${message}`);
  process.exit(1);
}

const markdown = readFileSync(process.argv[2], "utf8");
const receipts = [...markdown.matchAll(/^```json\r?\n([\s\S]*?)\r?\n```\r?$/gm)];
if (receipts.length !== 1) fail("expected one fenced JSON receipt");

let receipt;
try {
  receipt = JSON.parse(receipts[0][1]);
} catch {
  fail("invalid JSON");
}

const { headSha, url, jobs } = receipt ?? {};
if (typeof headSha !== "string" || !/^[0-9a-f]{40}$/.test(headSha)) {
  fail("expected a full commit SHA");
}
if (typeof url !== "string" || !/^https:\/\/github\.com\/gforge-esc\/gwrk\/actions\/runs\/[1-9][0-9]*$/.test(url)) {
  fail("expected a GitHub Actions run URL for gforge-esc/gwrk");
}
if (!Array.isArray(jobs)) fail("expected a jobs array");

for (const name of ["ci (20)", "ci (22)"]) {
  const matches = jobs.filter((job) => job?.name === name);
  if (matches.length !== 1 || matches[0].conclusion !== "success") {
    fail(`expected one successful ${name} job`);
  }
  const steps = matches[0].steps;
  const lint = Array.isArray(steps) ? steps.filter((step) => step?.name === "Lint") : [];
  if (lint.length !== 1 || lint[0].conclusion !== "success") {
    fail(`expected one successful Lint step in ${name}`);
  }
}
console.log(headSha);
NODE
)

candidate_paths=(
  .
  ":(exclude)$evidence"
  ":(exclude)$feature/.gwrk/tasks.json"
  ":(exclude)$feature/.gwrk/findings.jsonl"
  ":(exclude)$feature/.gwrk/runs/"
)
if [[ $(git cat-file -t "$tested_sha" 2>/dev/null) != commit ]]; then
  echo "Hosted lint receipt: commit $tested_sha is missing from local history" >&2
  exit 1
fi
if ! git diff --quiet --no-ext-diff --ignore-submodules=none "$tested_sha" HEAD -- "${candidate_paths[@]}" ||
   ! git diff --quiet --no-ext-diff --ignore-submodules=none --cached HEAD -- "${candidate_paths[@]}" ||
   ! git diff --quiet --no-ext-diff --ignore-submodules=none -- "${candidate_paths[@]}"; then
  echo "Hosted lint receipt: commit $tested_sha does not match the candidate's tracked tree" >&2
  exit 1
fi
echo "Hosted lint receipt verified for $tested_sha"

test -f src/ci-lint-policy.test.ts
test -f src/architecture.test.ts
pnpm run build
pnpm run lint
pnpm exec vitest run src/ci-lint-policy.test.ts src/architecture.test.ts
node dist/cli.js define adr --check
CI=true pnpm run test:ci
