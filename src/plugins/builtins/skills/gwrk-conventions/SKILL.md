# gwrk Conventions

## Task Management
- Valid task statuses: `open`, `in_progress`, `completed`, `cancelled`.
- Task tracking must align with the `tasks.json` Zod schema (see `src/utils/state.ts` for reference).

## Commit Identity
- NEVER set commit authorship to "Gemini CLI" or other agent names.
- Use the authenticated user's git identity.

## File Naming & Structure
- Source code in `src/` MUST NOT use `.js` or `.jsx` extensions. Use `.ts` or `.tsx`.
- The `.agents/` directory is legacy and MUST NOT be used for new runtime configurations. All core logic has migrated to the builtin plugin architecture.
