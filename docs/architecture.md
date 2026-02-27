# gwrk Architecture

gwrk is a zero-dependency CLI written in TypeScript.

## High-Level Components
1. **gwrk tasks CLI**: Manages JSON/JSONL state and executes shell scripts.
2. **Commands**: `specify`, `plan`, `plan-to-tasks`, `tasks`.

## Tech Stack
- TypeScript (ES2022)
- Commander (CLI routing)
- fs/path utilities for flat-file management.
- No DB. No ORM. Pure Git-native flat files.
