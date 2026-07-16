#!/usr/bin/env bash
# Post-public setup script for gwrk GitHub repository.
# Run this AFTER making the repo public in GitHub Settings.
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail

REPO="gforge-esc/gwrk"

echo "=== gwrk GitHub Public Setup ==="
echo ""

# ─── 1. Repository Metadata ───
echo "→ Setting repository description, topics, and merge settings..."
gh repo edit "$REPO" \
  --description "Principal Engineer's operating system — spec-first, agent-powered shipping" \
  --delete-branch-on-merge \
  --enable-squash-merge \
  --enable-merge-commit=false \
  --enable-rebase-merge=false

gh repo edit "$REPO" \
  --add-topic cli \
  --add-topic developer-tools \
  --add-topic ai-coding \
  --add-topic typescript \
  --add-topic agent-orchestration

echo "✅ Repository metadata configured."
echo ""

# ─── 2. Custom Labels ───
echo "→ Creating custom labels..."

create_label() {
  gh label create "$1" --color "$2" --description "$3" --repo "$REPO" --force 2>/dev/null || true
}

create_label "pillar:discovery"     "8b5cf6" "Discovery pillar (P1)"
create_label "pillar:definition"    "3b82f6" "Definition pillar (P2)"
create_label "pillar:shipping"      "f59e0b" "Shipping pillar (P3)"
create_label "pillar:accountability" "10b981" "Accountability pillar (P4)"
create_label "plugin"               "6366f1" "Plugin system (agents, workflows, skills)"
create_label "cli"                  "ec4899" "CLI commands and UX"
create_label "alpha-known-issue"    "f97316" "Known alpha limitation"
create_label "breaking-change"      "dc2626" "Breaking change"

# Community-contribution enablers (public-repo specific).
create_label "good-first-issue"     "7057ff" "Good entry point for new contributors"
create_label "help-wanted"          "008672" "Maintainers would welcome help here"

# Ensure the GitHub defaults referenced by the issue templates exist, in case
# the default label set was pruned (bug_report.yml -> bug, feature_request.yml -> enhancement).
create_label "bug"                  "d73a4a" "Something isn't working"
create_label "enhancement"          "a2eeef" "New feature or request"

echo "✅ Labels created."
echo ""

# ─── 3. Branch Protection Rulesets ───
# NOTE: the required_status_checks contexts below (`ci (20)` and `ci (22)`) must
# match the node-version matrix in .github/workflows/ci.yml exactly. A context
# that CI never produces is a required check that never reports and blocks every
# PR. These rulesets are created with POST (create-only); to change an existing
# ruleset, PATCH repos/$REPO/rulesets/<id> or edit it in the web UI.
echo "→ Creating branch protection rulesets..."

# Ruleset: production (main)
gh api repos/"$REPO"/rulesets \
  --method POST \
  --input - <<'EOF'
{
  "name": "production",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/main"],
      "exclude": []
    }
  },
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          { "context": "ci (20)" },
          { "context": "ci (22)" }
        ]
      }
    },
    { "type": "required_linear_history" },
    { "type": "non_fast_forward" },
    { "type": "deletion" }
  ]
}
EOF
echo "  ✅ 'production' ruleset created (main: 1 approval, CI, linear history)"

# Ruleset: integration (develop)
gh api repos/"$REPO"/rulesets \
  --method POST \
  --input - <<'EOF'
{
  "name": "integration",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/develop"],
      "exclude": []
    }
  },
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          { "context": "ci (20)" },
          { "context": "ci (22)" }
        ]
      }
    },
    { "type": "non_fast_forward" },
    { "type": "deletion" }
  ]
}
EOF
echo "  ✅ 'integration' ruleset created (develop: PR required, CI, no force push)"
echo ""

# ─── 4. GitHub Discussions ───
echo "→ Enabling GitHub Discussions..."
gh api --method PATCH "repos/$REPO" -F has_discussions=true >/dev/null
echo "✅ Discussions enabled. Create categories in the web UI (see footer)."
echo ""

# ─── 5. Public roadmap Project (opt-in) ───
# Delegates to setup-roadmap-project.sh (create/configure the board, Horizon
# field, and Status lifecycle — all via gh). Idempotent. Needs project scope:
#   gh auth refresh -s project,read:project
if [ "${GWRK_CREATE_PROJECT:-0}" = "1" ]; then
  bash "$(dirname "$0")/setup-roadmap-project.sh"
else
  echo "→ Skipping roadmap Project setup (run scripts/setup-roadmap-project.sh,"
  echo "  or re-run this with GWRK_CREATE_PROJECT=1)."
fi
echo ""

echo "=== Setup Complete ==="
echo ""
echo "Remaining manual steps:"
echo "  1. Rotate the Slack webhook in Slack admin (the old URL is in git history)"
echo "  2. Verify https://github.com/$REPO looks correct"
echo "  3. Create a test PR to verify CI triggers (expect checks 'ci (20)' and 'ci (22)')"
echo "  4. Create Discussion categories so their slugs match .github/DISCUSSION_TEMPLATE/*.yml:"
echo "       Announcements · alpha-feedback · ideas · show-and-tell · q-a"
echo "  5. Create the public roadmap Project (re-run with GWRK_CREATE_PROJECT=1, or do it in the web UI)"
echo "  6. Fill in .github/CODEOWNERS (maintainer handle) and .github/FUNDING.yml (sponsor channel)"
