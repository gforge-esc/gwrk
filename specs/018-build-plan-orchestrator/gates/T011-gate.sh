#!/bin/bash
# T011: Implement package.json (graphology)
set -e
grep -q "\"graphology\"" package.json
echo "T011: graphology dependency added."