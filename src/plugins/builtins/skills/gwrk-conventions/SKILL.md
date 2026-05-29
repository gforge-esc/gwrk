# GWRK Conventions (gwrk-conventions)

These rules define the platform vocabulary and operational standards for gwrk.

## Task Management

All tasks must use the following statuses in `tasks.json`:
- `open`: Task is ready for work.
- `in_progress`: Task is currently being worked on.
- `completed`: Task has been implemented and verified.
- `cancelled`: Task is no longer needed.

## Commit Identity Rules

When committing, ensure your git identity is correctly configured. 
Avoid leakage of local system paths or private information in commit messages.
The `GIT_AUTHOR_NAME` and `GIT_AUTHOR_EMAIL` should be consistent with the project's standards.

## Legacy Directory Warning

The `.agents/` directory is LEGACY. 
- NEVER read from or write to `.agents/` during runtime.
- All workflows and skills must be resolved via the plugin system.
- Migration to `.gwrk/` and `src/plugins/builtins/` is mandatory.

## File Naming

- Use kebab-case for all file and directory names.
- Test files must follow the `.test.ts` or `.spec.ts` suffix convention.

## No Placeholders

- NEVER use hardcoded placeholder values (e.g., `"TODO"`, `"PLACEHOLDER"`).
- Implement the logic or mark the task as blocked.
