# Contract: Skill Runtime

This contract defines the execution engine for Layer 2 Skill plugins.

## Service: `SkillRuntime`

### `executeSkill(name: string, input: string, options?: SkillOptions): Promise<SkillResult>`

Resolves and executes a skill by name.

- **name**: Skill identifier (e.g., `narrative` or `signal-cut`).
- **input**: Text received on stdin.
- **Options**: `format` (json|text), `agentMode` (boolean), `flags` (Record of values).
- **Execution Workflow (Atomic)**:
  1. Load `manifest.yaml` + `SKILL.md`.
  2. Assemble prompt using `manifest.prompt` + `SKILL.md` instructions.
  3. Resolve agent backend via `selectBackend()`.
  4. Call `AgentBackend.dispatch()`.
  5. Parse result and apply F013 signal formatting.
- **Execution Workflow (Compound)**:
  1. Load `manifest.yaml`.
  2. Recursively load all skills in `composes` list.
  3. Assemble a single prompt from all `passes` in order.
  4. Invoke agent (thinking models preferred for multi-pass).
- **Returns**: `SkillResult { stdout, stderr, exitCode, durationMs }`.

## Service: `SkillDiscovery`

### `listAvailableSkills(): Promise<SkillSummary[]>`

Returns all skills grouped by tier (atomic/compound) with their metadata.

- **Returns**: Array of `{ name, tier, category, description, flags[] }`.
- **Assertion**: MUST scan `~/.gwrk/plugins/skills/` globally.
- **Assertion**: SHOULD provide enriched help text for `gwrk skill <name> --help`.

### `resolveEnforcementSkills(root: string, scope?: string, profile?: ProjectProfile): Promise<string>`

Resolves all enforcement skills applicable to the project and returns combined content.

- **root**: Project root directory.
- **scope**: Filter by `implementation`, `review`, or `all`.
- **profile**: Optional project profile for language/toolchain filtering (R007).
- **Precedence**: project-local > global > builtins.
- **Returns**: Markdown string with markers `<!-- enforcement-skill: <name> -->`.
