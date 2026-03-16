---
description: Author gate scripts from contracts and gate brief. Called by gwrk define tasks.
---

# /author-gates

**Persona**: Test Engineer
**Pillar**: Definition (Clarity)
**ADR**: ADR-005 (TDD Gate Architecture)

<scope_constraints>
- Create ONLY gate scripts in `{feature_dir}/gates/`.
- Do NOT modify tasks.json, spec.md, plan.md, or any source code.
- Do NOT implement features — only write verification scripts.
</scope_constraints>

## Inputs

- `feature_dir`: Path to spec directory (e.g., `specs/000-tdd-infrastructure`)
- `GWRK_CONTEXT`: Path to gate brief JSON file (structured `GateBrief`)

## Steps

### 1. Load context
// turbo
```bash
cat "$GWRK_CONTEXT"
```

Read the gate brief JSON. This contains:
- `feature`: feature ID
- `projectType`: today always `"gwrk-typescript"`
- `tasks[]`: array of `TaskBrief` objects with `taskId`, `title`, `description`, `primaryFile`, `fileType`, `identifiers`, `doneWhenCommands`, `contractRefs`

### 2. Read feature artifacts
// turbo
```bash
ls {feature_dir}/spec.md {feature_dir}/plan.md {feature_dir}/contracts/*.md 2>/dev/null
```

Read:
- `{feature_dir}/spec.md` — what the feature promises
- `{feature_dir}/plan.md` — how it's structured
- `{feature_dir}/contracts/*.md` — behavior contracts (authoritative)
- `{feature_dir}/.gwrk/tasks.json` — task state

### 3. For each task, read source files
// turbo

For each task in the brief where `primaryFile` is not null:
```bash
cat {primaryFile} 2>/dev/null || echo "File not found: {primaryFile}"
```

Read the actual source file to understand what's been implemented.

### 4. Author gate scripts

For each task in the brief, create `{feature_dir}/gates/{taskId}-gate.sh`.

<gate_rules>
Every gate script MUST:
1. Start with `#!/bin/bash` + `set -euo pipefail`
2. Have `# AUTHORED` on line 2
3. Have at least ONE assertion that invokes a real tool (pnpm, grep, bash -n, jq, test)
4. End with `echo "PASS: {taskId} — {title}"`
5. NOT contain `GATE_STUB`

Assertion rules by file type:

- **test** (`*.test.ts`): `pnpm vitest run {file} --reporter=verbose`
- **typescript** (`*.ts`): `test -f {file}` + `grep -q '{identifier}' {file}` for each identifier + `test -f dist/{compiledPath}` (compiled output check)
- **shell** (`*.sh`): `test -f {file}` + `bash -n {file}` + `test -x {file}`
- **markdown** (`*.md`): `test -f {file}` + `grep -q '{section}' {file}` for key sections from contracts
- **json** (`*.json`): `test -f {file}` + `jq . {file} > /dev/null` (valid JSON)
- **config** (`*.yml`/`*.yaml`): `test -f {file}`

If `doneWhenCommands` exist for this task, include them as assertions.

If `contractRefs` exist, read the referenced contract and derive assertions from its method signatures, schemas, and error states.

If a task genuinely cannot be gated (no file, no identifiers, no contract), the gate MUST:
- Explain WHY in a comment
- `echo "FAIL: {taskId} — cannot gate: {reason}"` + `exit 1`
- This is honest failure, not a stub.

`test -f` alone is NEVER acceptable as a sole assertion.
</gate_rules>

### 5. Preserve existing authored gates
// turbo
```bash
for gate in {feature_dir}/gates/T*-gate.sh; do
  if head -3 "$gate" | grep -q "# AUTHORED" 2>/dev/null; then
    echo "PRESERVE: $(basename $gate)"
  fi
done
```

Do NOT overwrite any gate that already contains `# AUTHORED`.

### 6. Verify all gates

After writing, verify each gate has the required markers:
// turbo
```bash
for gate in {feature_dir}/gates/T*-gate.sh; do
  if ! head -3 "$gate" | grep -q "# AUTHORED"; then
    echo "ERROR: $(basename $gate) missing # AUTHORED marker"
  fi
done
```

## Anti-Patterns

- ❌ Writing `GATE_STUB` or any unconditionally-failing stub
- ❌ Using `test -f` as the sole assertion
- ❌ Overwriting gates marked `# AUTHORED`
- ❌ Modifying any source code
- ❌ Modifying tasks.json
- ❌ Creating gates that don't exit cleanly (every gate must exit 0 on pass or non-0 on fail)
