---
description: Update the master build plan when adding, modifying, or reordering features.
---

# /gwrk-build-plan

**Persona**: Program Manager
**Pillar**: Definition (Governance)

<terminology>
These terms are AUTHORITATIVE. All agents MUST use them exactly as defined.

| Term | Meaning | Example |
|---|---|---|
| **Feature** | A spec subdirectory under `specs/`. Has its own spec.md, plan.md, contracts/, gates/, etc. Identified by a three-digit number (NNN). | `specs/001-cli-core/` = Feature 001 |
| **Phase** | An implementation stage *within* a feature's `plan.md`. A feature has 1+ phases. | Phase 1 of Feature 013 = "Foundation" |
| **Wave** | A scheduling group of features that can execute concurrently in the build plan. | Wave 2 = {F013, F006, F007, F012} |

**Feature ≠ Phase.** The build plan orders *features*. Workflows execute *phases within features*. Never call a feature a "phase" in the build plan. Graph nodes use `F` prefix: `F001`, `F013`, etc.

### Role Model

| Role | Label | Meaning |
|---|---|---|
| **PM** | Product/Program Manager | Definitional work: specs, architecture, protocol design, gap analysis, workflow design |
| **PE** | Principal Engineer | Construction work: implementation, tests, gates, audit, remediation |

Effort table tags each feature as `PE`, `PM`, or `PM+PE`. PM+PE indicates significant definitional design *and* implementation work. There is no TS (Technical Staff) role — gwrk does not subdivide PE into junior/senior/QA/UAT.
</terminology>

<scope_constraints>
- Modify ONLY `specs/000-build-plan.md`.
- Do NOT create specs, plans, tasks, or code.
- Do NOT modify existing spec.md or plan.md files.
- Validate dependency graph acyclicity after every change.
- Report impact on existing wave structure and critical path.
- Use Feature (not Phase) terminology for spec subdirectories.
- Tag new features with PE, PM, or PM+PE in the effort table.
</scope_constraints>

## Inputs

- `action`: One of `add | modify | reorder | status-update | cluster-check`
- `spec_details`: Description of the change (for `add`: name, purpose, dependencies, SP estimate, role tag)

## Prerequisites

- `specs/000-build-plan.md` exists.

## Algorithm

### For `add` (new feature)

1. Read `specs/000-build-plan.md` — full document.
2. Assign next available feature number (scan the Features section for max).
3. Determine dependency edges:
   - Read existing feature summaries for shared components/types
   - Identify what the new feature depends on
   - Identify what (if anything) depends on this feature
4. Determine wave placement:
   - Place in the earliest wave where all dependencies are satisfied
   - If no existing wave fits, create a new wave or attach as a parallel track
5. Determine role tag:
   - PM+PE: if feature requires significant spec/architecture/protocol design work
   - PE: if predominantly implementation, audit, or remediation
   - PM: if predominantly definitional (rare — most features have implementation)
6. Update ALL affected sections of `000-build-plan.md`:
   - Dependency Graph (mermaid diagram — add `F{NNN}` node and edges)
   - Critical Path (recalculate if new feature is on critical path)
   - Features section (add feature block with spec, content, gate, dependencies)
   - Wave Strategy (wave placement)
   - Estimated Effort (SP, role tag, estimated hours)
   - Open Questions (add OQ rows if any blockers exist)
7. Add a changelog entry at the bottom of the document:
   ```markdown
   - {YYYY-MM-DD} (v{N}): Added Feature {NNN} ({name}). Wave {W}. Dependencies: [{deps}]. Role: {PE|PM|PM+PE}. Impact: {summary}.
   ```
8. Validate:
   - Dependency graph is acyclic (trace all paths — no cycles)
   - SP totals are updated and consistent
   - No orphaned features (every feature has ≥1 dependency edge or is a root)
   - No duplicate feature numbers
   - Every feature appears in: dependency graph, features section, wave table, effort table
   - Graph nodes use `F{NNN}` prefix, not `P{N}`
9. Report:
   > "Feature {NNN} added to Wave {W}. Dependencies: [{deps}]. Role: {tag}. {N} existing features affected. Critical path {unchanged|extended by {M} SP}."

### For `cluster-check`

Determines what cluster a feature belongs to and what should be defined together.

1. Read `specs/000-build-plan.md` Wave Strategy section.
2. Identify the feature's wave.
3. Apply the clustering decision tree:
   ```
   a. IDENTIFY the wave containing the feature
   b. LIST all unspecified features in that wave
   c. CHECK: Does the next wave share architectural components?
      - YES → extend cluster
      - NO → stop
   d. CHECK: Would extending exceed 3 waves or cross an OQ gate?
      - YES → stop
      - NO → repeat (c)
   ```
4. Check which features in the cluster already have `spec.md`:
   ```bash
   ls specs/*/spec.md 2>/dev/null
   ```
5. Report:
   > "Feature {NNN} is in Wave {W}, part of the [{cluster_name}] cluster.
   > Cluster contains: [{all features}]
   > Already defined: [{specified features}]
   > Remaining to define: [{unspecified features}]
   > Recommendation: Define [{remaining}] before starting `/implement` on any feature in this cluster."

<cluster_enforcement>
The cluster-check action is INFORMATIONAL — it does not block `/specify` or `/implement`.
However, `/implement` SHOULD NOT start on any feature in a wave until all features in that wave
have at least `spec.md`. This is a SHOULD, not a MUST — the user may override.
</cluster_enforcement>

### For `status-update`

1. Read `specs/000-build-plan.md` Features section.
2. Update the status marker for the specified feature (✅, 🟡, 🔒, etc.).
3. If status is ✅ Complete:
   - Check downstream features in the Dependency Graph
   - Propagate unblocking: update dependents from 🔒 Blocked → 🟡 Ready (if all their deps are complete)
4. Add changelog entry.
5. Report:
   > "Feature {NNN} → {new_status}. {N} features newly unblocked: [{list}]."

### For `modify` (change existing feature metadata)

1. Read `specs/000-build-plan.md`.
2. Update the specified fields (SP estimate, wave, dependencies, role tag, etc.).
3. If dependencies changed: validate acyclicity and update Dependency Graph.
4. If wave changed: update Wave Strategy.
5. If SP changed: update Estimated Effort totals.
6. Add changelog entry.
7. Report impact.

### For `reorder` (change wave execution order)

1. Read `specs/000-build-plan.md` Dependency Graph and Wave Strategy.
2. Validate the proposed reorder respects dependency constraints:
   - No feature can be in a wave before its dependencies' wave
3. If valid: update Wave Strategy and Critical Path.
4. If invalid: report which dependency constraints are violated.
5. Add changelog entry.

<quality_gate>
Before reporting, verify:
- Dependency graph is acyclic
- All features have at least one dependency edge or are root
- SP totals in Estimated Effort are consistent with individual feature SPs
- Every feature in the Features section appears in: Dependency Graph, Wave Strategy, Estimated Effort
- Changelog entry exists for this change
- Graph nodes use `F{NNN}` prefix (not `P{N}` or `Phase {N}`)
- Role tags are PE, PM, or PM+PE (not TS, DE, RE, or other codes)
- Terminology is correct: "Feature" for spec subdirectories, "Phase" only for stages within a feature
</quality_gate>

## Anti-Patterns

- ❌ Modifying existing spec.md or plan.md content (that's `/specify` and `/plan`'s job)
- ❌ Reordering waves without checking dependency constraints
- ❌ Adding features without dependency edges (every feature must be connected to the graph)
- ❌ Removing features without checking for dependents (cascade impact must be reported)
- ❌ Changing SP estimates without updating effort totals
- ❌ Skipping the acyclicity validation
- ❌ Adding a feature to a wave before its dependencies' wave
- ❌ Starting `/implement` before entire wave has `spec.md` (clustering rule)
- ❌ Creating clusters that span more than 3 consecutive waves
- ❌ Calling a Feature a "Phase" in the build plan (Feature ≠ Phase)
- ❌ Using the `TS` role tag (use PE, PM, or PM+PE)

## Expansion Protocol — Quick Reference

When new work is identified (during or after existing implementation):

```
1. ASSESS: New feature or extension of existing feature?
   - Extension → update that feature via /specify, then re-plan via /plan
   - New feature → /build-plan add

2. REGISTER: /build-plan add {spec_details}
   - Assigns number, places in wave, tags role, updates all sections

3. VALIDATE: Quality gate passes (acyclic, totals, terminology)

4. PROCEED: /specify for the new feature (can happen in parallel if non-blocking)
```
