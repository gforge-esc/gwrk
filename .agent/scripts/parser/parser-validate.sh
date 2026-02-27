#!/bin/bash
# .agent/scripts/parser/parser-validate.sh
# Usage: ./parser-validate.sh <parser-id>

set -e

PARSER_ID=$1

if [ -z "$PARSER_ID" ]; then
    echo "Usage: $0 <parser-id>"
    exit 1
fi

BASE_DIR="apps/api/src/services/parsers/$PARSER_ID"

# 1. Structural Checks (Exit Code 1)
if [ ! -d "$BASE_DIR" ]; then
    echo "❌ Error: Parser directory not found: $BASE_DIR"
    exit 1
fi

REQUIRED_FILES=("index.ts" "config.ts" "QuestionBuilder.ts" "ResponseDetector.ts")
for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$BASE_DIR/$file" ]; then
        echo "❌ Error: Missing required file: $BASE_DIR/$file"
        exit 1
    fi
done

echo "✅ Structure valid."

# 2. Interface Compliance (Exit Code 2)
echo "Checking interface compliance..."

# Use node with tsx to check exports without full compilation if possible, 
# but better to just use tsc for real verification.
if ! pnpm tsc --noEmit -p apps/api/tsconfig.json; then
    echo "❌ Error: TypeScript compilation failed in apps/api"
    exit 2
fi

# 3. Implementation Completeness (Exit Code 3)
echo "Checking for 'Not implemented' stubs..."
if grep -q "throw new Error('Not implemented')" "$BASE_DIR/index.ts"; then
    echo "❌ Error: Implementation incomplete - 'Not implemented' error remains in index.ts"
    exit 3
fi

if grep -q "TODO:" "$BASE_DIR/index.ts"; then
    echo "⚠️ Warning: TODO items remaining in index.ts"
    # We don't exit here, but it's a good warning
fi

echo "✅ Parser $PARSER_ID validated successfully!"
exit 0
