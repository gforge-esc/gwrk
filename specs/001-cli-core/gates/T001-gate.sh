#!/bin/bash
set -e
test -f package.json
grep -q '"commander":' package.json
test -f tsconfig.json
