# `.agents/` Removal: Dependency Map & Plan

## Directive

> `.agents` must be marked for removal. gwrk must work if/when `.agents` is deleted.

---

## Current State: What's In `.agents/`

```
.agents/                              (39 files, 6 subdirectories)
├── rules/                            ← PROJECT GOVERNANCE
│   ├── operating-model.md            (Foxtrot Charlie, RAGB, anti-ceremony)
│   └── workspace.md                  (stack, directory structure, never-evers)
├── workflows/                        ← WORKFLOW PROMPTS (16 files)
│   ├── gwrk-analyze.md
│   ├── gwrk-author-gates.md
│   ├── gwrk-build-plan.md
│   ├── gwrk-cascade-sync.md
│   ├── gwrk-checklist.md
│   ├── gwrk-constitution.md
│   ├── gwrk-define-tests.md
│   ├── gwrk-effort.md
│   ├── gwrk-implement.md
│   ├── gwrk-plan-to-tasks.md
│   ├── gwrk-plan.md
│   ├── gwrk-research.md
│   ├── gwrk-review-code.md           ← THE REAL REVIEW PROMPT (269 lines)
│   ├── gwrk-review-uat.md            ← THE REAL UAT PROMPT
│   ├── gwrk-specify.md
│   ├── plan.md                        (legacy alias)
│   └── specify.md                     (legacy alias)
├── skills/                            ← COMPOUND REASONING SKILLS (11 dirs)
│   ├── architecture-stress-test/
│   ├── audience-model/
│   ├── decision-forge/
│   ├── governance-audit/
│   ├── naming-forge/
│   ├── position-lock/
│   ├── signal-cut/
│   ├── specify-sharpen/
│   ├── test-skill/
│   ├── test-skill-2/
│   └── truth-extract/
├── prompts/personas/                  ← AGENT PERSONAS (3 files)
│   ├── principal-engineer.md
│   ├── product-manager.md
│   └── senior-dev.md
├── scripts/parser/                    ← HELPER SCRIPTS (2 files)
│   ├── parser-scaffold.sh
│   └── parser-validate.sh
└── templates/                         ← REFERENCE TEMPLATES (3 files)
    ├── e2e-patterns.md
    ├── monorepo-context.md
    └── verification-gate.md
```

---

## Where Content Already Lives in the 014 Plugin System

| `.agents/` content | Plugin equivalent | Status |
|---|---|---|
| `workflows/gwrk-specify.md` | `builtins/workflows/gwrk-specify/PROMPT.md` | ✅ Exists |
| `workflows/gwrk-plan.md` | `builtins/workflows/gwrk-plan/PROMPT.md` | ✅ Exists |
| `workflows/gwrk-implement.md` | `builtins/workflows/gwrk-implement/PROMPT.md` | ✅ Exists |
| `workflows/gwrk-define-tests.md` | `builtins/workflows/gwrk-define-tests/PROMPT.md` | ✅ Exists |
| `workflows/gwrk-author-gates.md` | `builtins/workflows/gwrk-author-gates/PROMPT.md` | ✅ Exists |
| `workflows/gwrk-plan-to-tasks.md` | `builtins/workflows/gwrk-plan-to-tasks/PROMPT.md` | ✅ Exists |
| `workflows/gwrk-review-code.md` | `builtins/workflows/gwrk-review-code/PROMPT.md` | ⚠️ Stale copy (264 lines vs 269) |
| `workflows/gwrk-review-uat.md` | `builtins/workflows/gwrk-review-uat/PROMPT.md` | ⚠️ Stale copy |
| `workflows/gwrk-build-plan.md` | `builtins/workflows/gwrk-build-plan/PROMPT.md` | ✅ Exists |
| `workflows/gwrk-research.md` | `builtins/workflows/gwrk-research/PROMPT.md` | ✅ Exists |
| `workflows/gwrk-analyze.md` | — | ❌ No builtin |
| `workflows/gwrk-cascade-sync.md` | — | ❌ No builtin |
| `workflows/gwrk-checklist.md` | — | ❌ No builtin |
| `workflows/gwrk-constitution.md` | — | ❌ No builtin |
| `workflows/gwrk-effort.md` | — | ❌ No builtin |
| `skills/*` (11 skills) | `~/.gwrk/plugins/skills/*` | ✅ Migrated via `gwrk init` |
| `rules/*` | — | ❌ **No plugin equivalent** |
| `prompts/personas/*` | — | ❌ **No plugin equivalent** |
| `scripts/parser/*` | — | ❌ **No plugin equivalent** |
| `templates/*` | — | ❌ **No plugin equivalent** |

---

## Code References to `.agents/` (Excluding `config.agents.*` which is unrelated)

### Production Code

| File | Line(s) | Reference | Impact |
|---|---|---|---|
| [migrate.ts](file:///Users/gonzo/Code/gwrk/src/plugins/migrate.ts#L18-L32) | 18-32 | Reads `.agents/skills/` and `.agents/workflows/` | **Migration tool.** Converts .agents → ~/.gwrk/plugins. Keep as legacy cleanup, eventually delete. |
| [skill-runtime.ts](file:///Users/gonzo/Code/gwrk/src/plugins/skill-runtime.ts#L125) | 125 | Log string `.agents/skills/${name}/manifest.yaml` | **Cosmetic.** Just a log label. Update to reflect plugin path. |
| [drift-detector.ts](file:///Users/gonzo/Code/gwrk/src/engine/drift-detector.ts#L24-L52) | 24-52 | Checks if `.agents/` artifacts exist for shipped phases | **Intentional debt detector.** Flags `.agents/` as stale. This is the right behavior — keep it as the removal canary. |
| [slack-agent.ts](file:///Users/gonzo/Code/gwrk/src/server/slack-agent.ts#L26) | 26 | Checks if text contains `.agents/workflows/` | **Slack message filtering.** Update to check for plugin paths instead. |

### Agent Dispatch (agent.ts)

| File | Line(s) | Reference | Impact |
|---|---|---|---|
| [agent.ts](file:///Users/gonzo/Code/gwrk/src/utils/agent.ts#L341-L382) | 341-382 | `resolveWorkflowPath()` — falls back to raw path if it contains `/` and exists on disk | **Critical.** This is the backwards-compat path that allows `.agents/workflows/gwrk-implement.md` to resolve directly. With `.agents/` gone, all resolution goes through `PluginLoader` (the correct path). **No code change needed** — the fallback just won't match. |

### Governance Context Files

| File | Points To | Reality |
|---|---|---|
| `AGENTS.md` | `.agents/rules/` | ← Points to real location |
| `GEMINI.md` | `.gwrk/rules/` | ← Points to phantom (`.gwrk/rules/` doesn't exist) |
| `workspace.md` (user_rules) | `.agents/rules/operating-model.md` | ← Points to real location |
| `.gwrk/agent-context.md` | `~/.gwrk/plugins/workflows/`, `~/.gwrk/plugins/skills/` | ✅ Already clean |

### Test Files (7 references)

All test fixtures that create `.agents/rules/` directories or reference `.agents/workflows/` paths. These update when the source changes.

---

## The Removal Plan

### 1. Rules → `.gwrk/rules/`

Rules are project-specific governance. They belong in the project-local `.gwrk/` directory, not in `.agents/` and not in the global `~/.gwrk/plugins/`.

**Action:**
- Create `.gwrk/rules/` directory
- Move `operating-model.md` and `workspace.md` to `.gwrk/rules/`
- Update `init.ts` to seed `.gwrk/rules/` from builtins (add `src/plugins/builtins/rules/`)
- Update `AGENTS.md` to point to `.gwrk/rules/`
- Update `workspace.md` (user_rules) to point to `.gwrk/rules/`
- `GEMINI.md` already points there — it just needs the directory to exist

### 2. Workflows → Builtins-only

The 10 workflows that already have builtins are done. The 5 that don't need builtins created:

**Missing builtins to create:**
- `gwrk-analyze`
- `gwrk-cascade-sync`
- `gwrk-checklist`
- `gwrk-constitution`
- `gwrk-effort`

**Action:**
- Create builtin plugin directories for the 5 missing workflows
- Sync the stale builtins (review-code, review-uat) with the `.agents/` versions
- `gwrk init` already seeds from `builtins/workflows/` — no init change needed
- Delete `plan.md` and `specify.md` legacy aliases

### 3. Skills → Already Migrated

Skills are already in `~/.gwrk/plugins/skills/` via `gwrk init` → `seedSkills()`. The `.agents/skills/` copies are legacy source. 

**Action:**
- Verify all 11 skills exist in `~/.gwrk/plugins/skills/`
- `migrate.ts` handles any stragglers — run it once, then the source is builtins

### 4. Personas → `.gwrk/personas/` or Builtins

Personas (`principal-engineer.md`, `product-manager.md`, `senior-dev.md`) define agent identity during review and ship stages. They're referenced by workflow prompts.

**Action:**
- Move to `src/plugins/builtins/personas/` (compiled into gwrk binary)
- Or move to `.gwrk/personas/` (project-local, seeded by init)
- Update workflow PROMPT.md files that reference persona paths

### 5. Scripts → `scripts/` or Delete

`parser-scaffold.sh` and `parser-validate.sh` are helper scripts. If they're still used, they belong in `scripts/dev/`. If not, delete.

### 6. Templates → `.specify/templates/` or Builtins

`e2e-patterns.md`, `monorepo-context.md`, `verification-gate.md` are reference templates. If they're used by workflows, they should be embedded in the PROMPT.md or moved to `.specify/templates/`.

### 7. Update References

| File | Change |
|---|---|
| `AGENTS.md` | `Rules: .agents/rules/` → `Rules: .gwrk/rules/` |
| `workspace.md` (user_rules) | `.agents/rules/operating-model.md` → `.gwrk/rules/operating-model.md` |
| `skill-runtime.ts:125` | Update log string |
| `slack-agent.ts:26` | Update string check |
| `drift-detector.ts` | Keep as-is (it's the canary) |
| `migrate.ts` | Keep as legacy cleanup tool, add deprecation warning |

### 8. The Final Delete

After all content is in its new home and verified:

```bash
# Verify gwrk works without .agents/
mv .agents .agents.bak
pnpm test
gwrk define spec --help  # workflows resolve from builtins
gwrk ship --help          # review resolves from builtins

# If all green:
rm -rf .agents.bak
```

---

## Verification Criteria

| Check | Command | Expected |
|---|---|---|
| Build passes | `pnpm build` | 0 errors |
| Tests pass | `pnpm test` | 0 failures |
| Workflow resolution | `gwrk define spec 001` | Resolves from builtins, not .agents |
| Review resolution | Ship code review stage | Uses review-code-cli plugin PROMPT.md |
| Rules accessible | Agent reads .gwrk/rules/workspace.md | Governance applied |
| `.agents/` absent | `ls .agents/` | No such directory |
| drift-detector | Runs on shipped phase | No false positives |
