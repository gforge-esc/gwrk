#!/usr/bin/env bash
# Configure the public roadmap Project (GitHub Projects v2) for gwrk.
#
# The external roadmap is Delivery's "trust artifact": directional, outcome-led.
# This board carries a public lifecycle + a Now/Next/Later horizon, grouped by
# the pillar:* labels. It intentionally has NO RAGB, owner, or initiative fields —
# those belong to the internal commitment spine, not the public board.
#
# Idempotent: finds the existing "gwrk roadmap" project (or creates one), then
# ensures visibility, the Horizon field, and the Status lifecycle options.
#
# Requires: gh with write access to org Projects.
#   gh auth refresh -s project,read:project
# Also needs: jq.
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail

REPO="${DATAORG_REPO:-gforge-esc/gwrk}"
OWNER="${OWNER:-${REPO%%/*}}"
TITLE="${PROJECT_TITLE:-gwrk roadmap}"

echo "=== gwrk roadmap Project setup (owner: $OWNER) ==="

# ─── 1. Find or create the project ───
NUM=$(gh project list --owner "$OWNER" --format json \
  | jq -r --arg t "$TITLE" '.projects[] | select(.title==$t) | .number' | head -1)

if [ -z "$NUM" ]; then
  echo "→ Creating project \"$TITLE\"..."
  NUM=$(gh project create --owner "$OWNER" --title "$TITLE" --format json | jq -r '.number')
  echo "  ✅ Created project #$NUM"
else
  echo "→ Found existing project #$NUM (\"$TITLE\") — configuring in place."
fi

URL=$(gh project view "$NUM" --owner "$OWNER" --format json | jq -r '.url')

# ─── 2. Ensure the Horizon field (Now / Next / Later) ───
HAS_HORIZON=$(gh project field-list "$NUM" --owner "$OWNER" --format json \
  | jq -r '[.fields[].name] | index("Horizon") // empty')
if [ -z "$HAS_HORIZON" ]; then
  echo "→ Adding 'Horizon' field (Now/Next/Later)..."
  gh project field-create "$NUM" --owner "$OWNER" \
    --name "Horizon" --data-type SINGLE_SELECT \
    --single-select-options "Now,Next,Later" >/dev/null
  echo "  ✅ Horizon added."
else
  echo "→ 'Horizon' field already present — leaving as-is."
fi

# ─── 3. Status lifecycle options (replaces the default Todo/In Progress/Done) ───
STATUS_FIELD_ID=$(gh project field-list "$NUM" --owner "$OWNER" --format json \
  | jq -r '.fields[] | select(.name=="Status") | .id')

echo "→ Setting Status lifecycle options..."
read -r -d '' MUTATION <<'GQL' || true
mutation($fieldId: ID!) {
  updateProjectV2Field(input: {
    fieldId: $fieldId
    singleSelectOptions: [
      { name: "🆕 Triage",      color: GRAY,   description: "New — not yet reviewed" }
      { name: "🔭 Considering", color: PURPLE, description: "Under evaluation" }
      { name: "🗓️ Planned",     color: BLUE,   description: "Committed direction, not started" }
      { name: "🚧 In progress", color: ORANGE, description: "Being built now" }
      { name: "✅ Shipped",      color: GREEN,  description: "Released" }
      { name: "🚫 Not planned", color: RED,    description: "Declined or superseded (with a reason)" }
    ]
  }) {
    projectV2Field { ... on ProjectV2SingleSelectField { options { name } } }
  }
}
GQL
gh api graphql -f query="$MUTATION" -f fieldId="$STATUS_FIELD_ID" >/dev/null
echo "  ✅ Status: Triage → Considering → Planned → In progress → Shipped / Not planned"

# ─── 4. Visibility: Public (a trust artifact) — done last, after full config ───
echo "→ Setting visibility to PUBLIC..."
gh project edit "$NUM" --owner "$OWNER" --visibility PUBLIC >/dev/null
echo "  ✅ Public."

# ─── 5. Publish the board URL for the add-to-project workflow ───
echo "→ Setting repo variable ROADMAP_PROJECT_URL=$URL ..."
gh variable set ROADMAP_PROJECT_URL --repo "$REPO" --body "$URL" >/dev/null \
  && echo "  ✅ Variable set." \
  || echo "  ⚠️  Could not set the repo variable (needs actions:write) — set it by hand."

echo ""
echo "=== Done. Board: $URL ==="
echo "Remaining (one-time):"
echo "  • Add secret ADD_TO_PROJECT_PAT (a PAT with project + repo scope) so"
echo "    .github/workflows/add-to-project.yml can auto-add new issues."
echo "  • In the board view, group by the pillar:* labels (Layout → Group)."
