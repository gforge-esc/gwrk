#!/bin/bash
# AUTHORED
set -euo pipefail

# T050: 4 built-in review plugins
test -d src/plugins/builtins/reviews/review-code-cli
test -d src/plugins/builtins/reviews/review-uat-cli
test -d src/plugins/builtins/reviews/review-code-webapp
test -d src/plugins/builtins/reviews/review-uat-webapp

# Each must have a manifest.yaml
test -f src/plugins/builtins/reviews/review-code-cli/manifest.yaml
test -f src/plugins/builtins/reviews/review-uat-cli/manifest.yaml
test -f src/plugins/builtins/reviews/review-code-webapp/manifest.yaml
test -f src/plugins/builtins/reviews/review-uat-webapp/manifest.yaml

echo "PASS: T050 — Implement built-in review plugins"
