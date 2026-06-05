# Contract: Ontology Service

This contract defines the methods for project knowledge management, including domain ontology construction and perspective management.

## Service: `OntologyService`

### `scaffold(projectRoot: string): Promise<void>`

Creates the directory structure for project knowledge.

- **Directories**: `.gwrk/ontology/`, `.gwrk/perspective/`.
- **Files**: Empty `domain.md`, `hierarchy.md`, `ux-posture.md` with headers.

### `construct(projectRoot: string, options?: ConstructionOptions): Promise<void>`

Executes the automated ontology construction workflow.

- **Options**: `sourceMaterial` (paths to scan), `agent`, `model`.
- **Workflow**: `gwrk-ontology-construct`.
- **Assertion**: MUST use the `SourceScanner` to gather grounding material.
- **Assertion**: MUST follow the Five Primitives methodology.

## Service: `SourceScanner`

### `scan(projectRoot: string): Promise<SourceMaterial>`

Scans the project for grounding material (specs, architecture, code patterns).

- **Returns**: `SourceMaterial { specs: string[], architecture: string, patterns: string[] }`.