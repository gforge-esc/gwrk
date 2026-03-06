#!/usr/bin/env bash
# Gate: T005 — Implement server CLI commands
set -euo pipefail

# Assertion #1: src/commands/server.ts exists
test -f src/commands/server.ts || { echo "FAIL: src/commands/server.ts not found"; exit 1; }

# Assertion #2: server command group defined
grep -q "new Command('server')" src/commands/server.ts || { echo "FAIL: 'server' command group not defined"; exit 1; }

# Assertion #3: start/stop subcommands exist
grep -q ".command('start')" src/commands/server.ts && grep -q ".command('stop')" src/commands/server.ts || { echo "FAIL: start or stop subcommands missing"; exit 1; }

# Assertion #4: server command registered in src/cli.ts
grep -q "server" src/cli.ts || { echo "FAIL: server command group not registered in src/cli.ts"; exit 1; }

echo "PASS: T005"
