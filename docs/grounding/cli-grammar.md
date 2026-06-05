# CLI Grammar Standard

This document defines the canonical grammar, naming conventions, and structural standards for the `gwrk` CLI.

## Core Philosophy: Foxtrot Charlie

The CLI surface is organized around the four pillars of the Foxtrot Charlie operating model:
- **Truth** (Discovery - mostly internal/agent-led)
- **Clarity** (Definition)
- **Throughput** (Shipping)
- **Value** (Measurement)

## Grammar

### Structure
All commands follow a consistent hierarchical pattern:
`gwrk <verb> [subverb] <feature> [phase] [--options]`

- **Verb**: The top-level pillar or operation (e.g., `define`, `ship`, `measure`).
- **Subverb**: The specific action (e.g., `spec`, `plan`, `pulse`).
- **Feature**: The target feature ID (e.g., `001-cli-core`). Supports **Prefix Aliasing**.
- **Phase**: Optional phase identifier.
- **Options**: Modifier flags (e.g., `--dry-run`, `--format json`).

### Prefix Aliasing
The CLI MUST resolve feature prefixes to full feature names.
- `gwrk define spec 001` → resolves to `specs/001-cli-core`
- `gwrk ship 014` → resolves to `specs/014-plugin-system`

## Command Inventory

### Clarity Pillar (`define`)
Commands that convert truth into buildable commitments.
- `gwrk define spec <feature>`: Create or refine a specification.
- `gwrk define plan <feature>`: Generate an implementation plan and contracts.
- `gwrk define tests <feature>`: Generate RED tests and gap matrix.
- `gwrk define tasks <feature>`: Decompose plan into `tasks.json` and gate scripts.

### Throughput Pillar (`ship`)
Commands that drive autonomous execution and verification.
- `gwrk ship <feature> [phase]`: The primary autonomous ship loop.
- `gwrk test <feature> [--phase N]`: Run tests scoped to a feature or phase.
- `gwrk gate <feature> <taskId>`: Manually execute a specific task gate.

### Value Pillar (`measure`)
Commands that prove delivered value and velocity.
- `gwrk measure pulse`: Git activity and productivity dashboard.
- `gwrk measure compression <feature>`: Effort forecast vs. actual delivery ratio. Runs `computeEffort()` internally — no standalone effort command needed.

### Operations
Infrastructure and state management.
- `gwrk init`: Initialize a new project or register an existing one.
- `gwrk tasks list <feature>`: Query task state and progress.
- `gwrk tasks next <feature> <phase>`: Identify the next actionable task.
- `gwrk tasks done <feature> <taskId>`: Verify and close a task.
- `gwrk db runs <feature>`: Query the execution ledger.
- `gwrk setup`: Provision workstation for unattended execution.

## Rules

### 1. Feature Argument Consistency
Every command that acts on a feature MUST take the feature ID as its first positional argument.

### 2. Help Text Examples
Every command MUST provide at least two concrete usage examples in its help text.

### 3. Prefix Aliasing
Every command taking a feature argument MUST support prefix aliasing via `resolveFeature`.

### 4. Format Options
Commands producing structured data SHOULD support `--format json`.
