# /gwrk-build-plan

**Persona**: Program Manager
**Pillar**: Definition (Governance)

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

(Algorithm from the original build-plan workflow)
