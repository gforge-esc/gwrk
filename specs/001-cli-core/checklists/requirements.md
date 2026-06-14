# Requirements Checklist: 001 CLI Core

## User Stories
- [ ] US-001: Project Initialization (`gwrk init`) ⭐ **EXTENDED**
- [ ] US-002: Agent Specification (`gwrk specify`)
- [ ] US-003: Agent Planning (`gwrk plan`)
- [ ] US-004: Task Decomposition (`gwrk tasks generate`)
- [ ] US-005: Task State Query (`gwrk tasks list`, `gwrk tasks next`)
- [ ] US-006: Hard Gate Enforcement (`gwrk tasks done`)
- [ ] US-007: Status Transition History (`.gwrk/history.jsonl`)
- [ ] US-008: Configuration Validation (`.gwrkrc.json` + Zod)
- [ ] US-011: Define Pillar DUS Loop (`gwrk define`)
- [ ] US-012: Ship Pillar Agent Dispatch (`gwrk ship <phase>`)
- [ ] US-013: Full Ship Lifecycle (`gwrk ship`)
- [ ] US-014: Execution History Query (`gwrk db runs`)
- [ ] US-015: Aggregate Statistics (`gwrk db stats`)
- [ ] US-016: Compression Tracking (`gwrk measure compression`)
- [ ] US-017: Pulse Dashboard (`gwrk measure pulse`)
- [ ] US-018: CLI Surface Verification
- [ ] US-019: Execution Manifest Writer
- [ ] US-020: Post-Merge Task Verification
- [ ] US-022: Help Text Examples
- [ ] US-023: Feature-Arg Consistency
- [ ] US-026: Define Pillar Output Parity
- [ ] US-027: Project Profile Auto-Detection
- [ ] US-028: Project-Aware Prompt Conditioning
- [ ] US-029: Project Profile Introspection
- [ ] US-030: Project-Scoped DB Isolation
- [ ] US-031: Plugin Management (`gwrk plugin`) ⭐ **NEW**
- [ ] US-032: Extension Detection ⭐ **NEW**

## Functional Requirements
- [ ] FR-001: `gwrk init` onboarding wizard ⭐ **EXTENDED**
- [ ] FR-002: `gwrk define spec` dispatch
- [ ] FR-003: `gwrk define plan` dispatch
- [ ] FR-004: `gwrk tasks generate` parsing
- [ ] FR-005: `gwrk tasks list/next` query
- [ ] FR-006: `gwrk tasks done` gate enforcement
- [ ] FR-011: `gwrk define` DUS loop
- [ ] FR-013: `gwrk ship` autonomous lifecycle
- [ ] FR-014: `gwrk db runs` query
- [ ] FR-015: `gwrk db stats` aggregation
- [ ] FR-019: Execution manifest writer
- [ ] FR-028: `define` subcommands quiet output
- [ ] FR-030: Project type auto-detection
- [ ] FR-033: Prompt profile injection
- [ ] FR-035: `gwrk project info`
- [ ] FR-036: Project ID resolution
- [ ] FR-041: `gwrk plugin search` ⭐ **NEW**
- [ ] FR-042: `gwrk plugin install` ⭐ **NEW**
- [ ] FR-043: `gwrk plugin update` ⭐ **NEW**
- [ ] FR-044: Registry cloning/provisioning ⭐ **NEW**
- [ ] FR-045: Extension discovery ⭐ **NEW**

## Technical Constraints
- [ ] TC-001: Sequential task IDs
- [ ] TC-002: Air-gapped CLI
- [ ] TC-003: Fail-fast config
- [ ] TC-004: Hard gates
- [ ] TC-008: Quiet agent output
- [ ] TC-009: Single prompt integration point
- [ ] TC-010: Backward compatibility (prompt assembly)
- [ ] TC-012: Plugin Registry URL ⭐ **NEW**

## Data Model
- [ ] DM-001: tasks.json schema
- [ ] DM-003: .gwrkrc.json schema (extended with profile + extensions)
- [ ] DM-005: Execution Manifest schema

## Tests
- [ ] TR-001: init command tests
- [ ] TR-021: Unified init / provisioning tests
- [ ] TR-026: Tolerant JSON extraction tests
- [ ] TR-027: Profile detector tests
- [ ] TR-031: Prompt conditioner tests
- [ ] TR-034: Prompt assembly regression tests
- [ ] TR-035: Plugin command tests ⭐ **NEW**
- [ ] TR-036: Registry resolution tests ⭐ **NEW**
- [ ] TR-037: Extension detector tests ⭐ **NEW**
