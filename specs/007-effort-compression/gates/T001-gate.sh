#!/usr/bin/env bash
# Gate: T001 — Create shared type definitions
# Contract: src/engine/types.ts must export all shared interfaces
set -euo pipefail

FILE="src/engine/types.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE does not exist" >&2; exit 1; }

# Assertion #2
grep -q 'export interface EffortReport' "$FILE" || { echo "FAIL: EffortReport interface missing" >&2; exit 1; }
# Assertion #3
grep -q 'export interface RoleBreakdown' "$FILE" || { echo "FAIL: RoleBreakdown interface missing" >&2; exit 1; }
# Assertion #4
grep -q 'export interface StoryEstimate' "$FILE" || { echo "FAIL: StoryEstimate interface missing" >&2; exit 1; }
# Assertion #5
grep -q 'export interface RoleConfig' "$FILE" || { echo "FAIL: RoleConfig interface missing" >&2; exit 1; }
# Assertion #6
grep -q 'export interface EffortForecast' "$FILE" || { echo "FAIL: EffortForecast interface missing" >&2; exit 1; }
# Assertion #7
grep -q 'export interface CompressionReport' "$FILE" || { echo "FAIL: CompressionReport interface missing" >&2; exit 1; }
# Assertion #8
grep -q 'export interface DeliveryActuals' "$FILE" || { echo "FAIL: DeliveryActuals interface missing" >&2; exit 1; }
# Assertion #9
grep -q 'export interface CompressionRatios' "$FILE" || { echo "FAIL: CompressionRatios interface missing" >&2; exit 1; }
# Assertion #10
grep -q 'export interface CompressionSummary' "$FILE" || { echo "FAIL: CompressionSummary interface missing" >&2; exit 1; }
# Assertion #11
grep -q 'export interface CommitCluster' "$FILE" || { echo "FAIL: CommitCluster interface missing" >&2; exit 1; }

echo "PASS: T001 — all shared type interfaces exported"
