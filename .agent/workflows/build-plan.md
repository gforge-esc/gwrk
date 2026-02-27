---
description: Update the master build plan when adding, modifying, or reordering specs.
---

# /build-plan

**Persona**: Program Manager
**Pillar**: Definition (Governance)

<scope_constraints>
- Modify ONLY `specs/000-build-plan.md`.
- Do NOT create specs, plans, tasks, or code.
- Do NOT modify existing spec.md or plan.md files.
- Validate dependency graph acyclicity after every change.
- Report impact on existing wave structure, clusters, and critical path.
- When adding or reordering specs, enforce §8a Definition Clustering Policy.
</scope_constraints>

## Inputs

- `action`: One of `add | modify | reorder | status-update | cluster-check`
- `spec_details`: Description of the change (for `add`: name, purpose, dependencies, SP estimate)

## Prerequisites

- `specs/000-build-plan.md` exists.

## Algorithm

### For `add` (new spec)

1. Read `specs/000-build-plan.md` — full document.
2. Assign next available spec number (scan §2 Spec Register for max).
3. Determine dependency edges:
   - Read existing spec summaries for shared components/types
   - Identify what the new spec depends on
   - Identify what (if anything) depends on this spec
4. Determine wave placement:
   - Place in the earliest wave where all dependencies are satisfied
   - If no existing wave fits, create a new wave or attach as a parallel track
5. Update ALL affected sections of `000-build-plan.md`:
   - §1 Dependency Graph (mermaid diagram — add node and edges)
   - §2 Spec Register (add row to appropriate phase table)
   - §3 Critical Path Analysis (recalculate if new spec is on critical path)
   - §5 Story Point Coverage (add mapped US-### or note "N/A — expansion")
   - §7 Gap Coverage (if maps to existing gaps)
   - §8 Execution Order (wave placement — add to existing wave table or create new)
   - §9 Forensic Guardrail Applicability (determine which I-CR-### apply)
   - §10 Open Question Gates (add OQ rows if any blockers exist)
6. Add a changelog entry at the bottom of the document:
   ```markdown
   ## Changelog
   - {YYYY-MM-DD}: Added Spec {NNN} ({name}). Wave {W}. Dependencies: [{deps}]. Impact: {summary}.
   ```
7. Validate:
   - Dependency graph is acyclic (trace all paths — no cycles)
   - SP totals are updated
   - No orphaned specs (every spec has ≥1 dependency edge or is a root spec)
   - No duplicate spec numbers
8. Report:
   > "Spec {NNN} added to Wave {W}, Cluster [{cluster_name}]. Dependencies: [{deps}]. {N} existing specs affected. Critical path {unchanged|extended by {M} SP}."

### For `cluster-check`

Determines what cluster a spec belongs to and what should be defined together, per §8a.

1. Read `specs/000-build-plan.md` §8 (Execution Order) and §8a (Definition Clustering Policy).
2. Identify the spec's wave from §8.
3. Apply the §8a agent decision tree:
   ```
   a. IDENTIFY the wave containing the spec
   b. LIST all unspecified specs in that wave
   c. CHECK: Does the next wave share architectural components?
      - YES → extend cluster
      - NO → stop
   d. CHECK: Would extending exceed 3 waves or cross an OQ gate?
      - YES → stop
      - NO → repeat (c)
   ```
4. Check which specs in the cluster already have `spec.md`:
   ```bash
   ls specs/*/spec.md 2>/dev/null
   ```
5. Report:
   > "Spec {NNN} is in Wave {W}, part of the [{cluster_name}] cluster.
   > Cluster contains: [{all specs}]
   > Already defined: [{specified specs}]
   > Remaining to define: [{unspecified specs}]
   > Recommendation: Define [{remaining}] before starting `/implement` on any spec in this cluster."

<cluster_enforcement>
The cluster-check action is INFORMATIONAL — it does not block `/specify` or `/implement`.
However, `/implement` SHOULD NOT start on any spec in a wave until all specs in that wave
have at least `spec.md`. This is a SHOULD, not a MUST — the user may override.
</cluster_enforcement>

### For `status-update`

1. Read `specs/000-build-plan.md` §2 (Spec Register).
2. Update the Status column for the specified spec.
3. If status is ✅ Complete:
   - Check downstream specs in §1 Dependency Graph
   - Propagate unblocking: update dependents from 🔒 Blocked → 🟢 Ready (if all their deps are complete)
4. Add changelog entry.
5. Report:
   > "Spec {NNN} → {new_status}. {N} specs newly unblocked: [{list}]."

### For `modify` (change existing spec metadata)

1. Read `specs/000-build-plan.md`.
2. Update the specified fields (SP estimate, wave, dependencies, etc.).
3. If dependencies changed: validate acyclicity and update §1 Dependency Graph.
4. If wave changed: update §8 Execution Order.
5. Add changelog entry.
6. Report impact.

### For `reorder` (change wave execution order)

1. Read `specs/000-build-plan.md` §1 and §8.
2. Validate the proposed reorder respects dependency constraints:
   - No spec can be in a wave before its dependencies' wave
3. If valid: update §8 Execution Order and §3 Critical Path.
4. If invalid: report which dependency constraints are violated.
5. Add changelog entry.

<quality_gate>
Before reporting, verify:
- Dependency graph is acyclic
- All specs have at least one dependency edge or are root
- SP totals in §5 are consistent with §2
- Every spec in §2 appears in §8 (Execution Order)
- Every spec in §2 appears in §9 (Guardrail Matrix)
- Every spec in §2 appears in a cluster in §8a (Cluster Status table)
- Changelog entry exists for this change
- No cluster spans more than 3 consecutive waves
- No cluster includes OQ-gated specs alongside non-gated specs
</quality_gate>

## Anti-Patterns

- ❌ Modifying existing spec.md or plan.md content (that's `/specify` and `/plan`'s job)
- ❌ Reordering waves without checking dependency constraints
- ❌ Adding specs without dependency edges (every spec must be connected to the graph)
- ❌ Removing specs without checking for dependents (cascade impact must be reported)
- ❌ Changing SP estimates without updating §5 totals
- ❌ Skipping the acyclicity validation
- ❌ Adding a spec to a wave before its dependencies' wave
- ❌ Starting `/implement` before entire wave has `spec.md` (§8a clustering rule 1)
- ❌ Creating clusters that span more than 3 consecutive waves (§8a rule 3)
- ❌ Including OQ-gated specs in engineering clusters (§8a rule 5)

## Expansion Protocol — Quick Reference

When new work is identified (during or after existing implementation):

```
1. ASSESS: New spec or extension of existing spec?
   - Extension → update that spec via /specify, then re-plan via /plan
   - New spec → /build-plan add

2. REGISTER: /build-plan add {spec_details}
   - Assigns number, places in wave, updates all sections

3. VALIDATE: Quality gate passes (acyclic, totals, coverage)

4. PROCEED: /specify for the new spec (can happen in parallel if non-blocking)
```
