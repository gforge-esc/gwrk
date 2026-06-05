# Ontology & Plugin Checklist: 014 Plugin System

**Purpose**: Verify the implementation of the ontology construction workflow and plugin infrastructure enhancements.
**Created**: 2026-06-03
**Feature**: [spec.md](../spec.md)

## Plugin Infrastructure

- [ ] CHK-001: `gwrk plugin list --project --type skills` correctly filters by language (FR-014, US-016)
- [ ] CHK-002: Built-in enforcement skills load automatically based on ProjectProfile (FR-014)
- [ ] CHK-003: Project-local enforcement skills in `.gwrk/plugins/` always load (FR-014)

## Ontology Construction

- [ ] CHK-004: `gwrk define ontology` scaffolds `.gwrk/ontology/` and `.gwrk/perspective/` (FR-L25-009, US-020)
- [ ] CHK-005: `gwrk define ontology --run` dispatches `gwrk-ontology-construct` workflow (FR-L25-010, US-021)
- [ ] CHK-006: `gwrk-ontology-construct` produces `domain.md` with Five Primitives (FR-L25-012, US-021)
- [ ] CHK-007: `gwrk-ontology-construct` produces `hierarchy.md` and `ux-posture.md` (FR-L25-010, US-021)
- [ ] CHK-008: Source material scanner correctly reads specs and architecture docs (FR-L25-011, US-022)
- [ ] CHK-009: Agent prompt correctly includes `<domain_ontology>` and perspective blocks (FR-L25-008, US-019)

## Testing & Verification

- [ ] CHK-010: `TR-014` passes for scaffolding logic (TR-014)
- [ ] CHK-011: `TR-015` passes for Five Primitives compliance (TR-015)
- [ ] CHK-012: `VR-019` E2E test successful in test project (VR-019)

## Notes
- Check items off as completed: `[x]`
- Items are numbered sequentially (CHK-NNN) for cross-reference
- Link findings to relevant FR-###, US-###, or TR-### identifiers
