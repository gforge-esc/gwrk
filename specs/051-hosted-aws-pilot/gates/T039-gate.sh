#!/usr/bin/env bash
set -euo pipefail
# AUTHORED: delegate to the shared behavioral phase gate.
gate_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec bash "${gate_dir}/phase-07.sh"
