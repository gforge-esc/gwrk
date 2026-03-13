#!/bin/bash
# .agent/scripts/parser/parser-scaffold.sh
# Usage: ./parser-scaffold.sh <parser-id>

set -e

PARSER_ID=$1

if [ -z "$PARSER_ID" ]; then
    echo "Usage: $0 <parser-id>"
    exit 1
fi

# Convert dash-case to PascalCase for variable naming
# e.g. mq-2025 -> Mq2025
PASCAL_ID=$(echo "$PARSER_ID" | sed -r 's/(^|-)([a-z])/\U\2/g' | sed 's/-//g')

# Safe identifier for TypeScript variable (e.g. mq2026Parser)
SAFE_ID=$(echo "$PARSER_ID" | sed 's/-//g')

BASE_DIR="apps/api/src/services/parsers/$PARSER_ID"
TEST_DIR="apps/api/tests/unit/parsers/$PARSER_ID"

if [ -d "$BASE_DIR" ]; then
    echo "Error: Parser directory already exists: $BASE_DIR"
    exit 1
fi

echo "Creating parser scaffold for: $PARSER_ID ($PASCAL_ID)"

mkdir -p "$BASE_DIR"
mkdir -p "$TEST_DIR"

# 1. index.ts
cat <<EOF > "$BASE_DIR/index.ts"
import type { ISurveyParser, ProcessedQuestion } from '../interface';

/**
 * ${PASCAL_ID} Parser implementation
 * TODO: Document any specific workbook assumptions
 */
export const ${SAFE_ID}Parser: ISurveyParser = {
    id: '${PARSER_ID}',
    name: 'TODO: Human readable name',
    description: 'TODO: Description for UI',
    version: '1.0.0',
    supportedTypes: ['MQ'], // TODO: Update based on requirements
    
    parseBuffer(buffer: Buffer): ProcessedQuestion[] {
        // TODO: Implement parsing logic
        // Recommendation: Delegate to ResponseDetector and QuestionBuilder
        throw new Error('Not implemented');
    },
};
EOF

# 2. config.ts
cat <<EOF > "$BASE_DIR/config.ts"
/**
 * Configuration and constants for the ${PASCAL_ID} parser.
 * Define column mappings, sheet names, and regular expressions here.
 */
export const CONFIG = {
    SHEET_NAME: 'Sheet1', // TODO: Update
    // Add more constants as needed
};
EOF

# 3. QuestionBuilder.ts
cat <<EOF > "$BASE_DIR/QuestionBuilder.ts"
import type { ProcessedQuestion } from '../interface';

/**
 * Logic for assembling and finalizing ProcessedQuestion objects.
 */
export class QuestionBuilder {
    finalizeQuestion(): Partial<ProcessedQuestion> {
        // TODO: Implement assembly logic
        return {};
    }
}
EOF

# 4. ResponseDetector.ts
cat <<EOF > "$BASE_DIR/ResponseDetector.ts"
/**
 * Logic for identifying response areas and extracting raw text from cells.
 */
export class ResponseDetector {
    parseYourResponse(): string {
        // TODO: Implement extraction logic
        return '';
    }
}
EOF

# 5. index.test.ts
cat <<EOF > "$TEST_DIR/index.test.ts"
import { describe, it, expect } from 'vitest';
import { ${SAFE_ID}Parser } from '../../../src/services/parsers/$PARSER_ID';

describe('${PASCAL_ID}Parser', () => {
    it('should have correct metadata', () => {
        expect(${SAFE_ID}Parser.id).toBe('${PARSER_ID}');
    });

    it('should throw error if not implemented', () => {
        expect(() => ${SAFE_ID}Parser.parseBuffer(Buffer.from([]))).toThrow('Not implemented');
    });
});
EOF

chmod +x "$0"

echo "✅ Scaffold created at $BASE_DIR"
echo "Next steps:"
echo "1. Implement logic in $BASE_DIR"
echo "2. Run ./.agent/scripts/parser/parser-validate.sh $PARSER_ID"
echo "3. Register in apps/api/src/services/parsers/index.ts"
