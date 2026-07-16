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

echo "✅ Labels created."
echo ""

# ─── 3. Branch Protection Rulesets ───
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
echo "=== Setup Complete ==="
echo ""
echo "Remaining manual steps:"
echo "  1. Rotate the Slack webhook in Slack admin (the old URL is in git history)"
echo "  2. Verify https://github.com/$REPO looks correct"
echo "  3. Create a test PR to verify CI triggers"
