# Getting Started & Configuration

`gwrk` layers configuration across three files so project identity stays tracked in Git while personal agent choices and secrets remain private.

## Configuration Layering

| Layer | Path | Tracked | Purpose |
|---|---|---|---|
| **Project** | `.gwrkrc.json` | Yes | Project identity, loopback port (`18790`), parallelism defaults |
| **Local** | `.gwrkrc.local.json` | No | Personal agent backend choice (`agy`, `claude`, `gemini`) and local registry |
| **Global** | `~/.gwrk/config.json` | No | Machine-wide credentials and notification tokens |

## First-Time Setup

```bash
# 1. Copy the local agent configuration template
cp .gwrkrc.local.json.example .gwrkrc.local.json

# 2. Initialize or repair project state and ~/.gwrk/setup.json
gwrk init

# 3. Verify architecture and ADR citation integrity
gwrk define adr --check
```

## Define -> Ship Workflow

Every feature follows a strict four-stage definition pipeline before autonomous execution begins:

```bash
# Stage 1: Specification with binary acceptance criteria
gwrk define spec 051-hosted-aws-pilot

# Stage 2: Phased implementation plan and contracts
gwrk define plan 051-hosted-aws-pilot

# Stage 3: RED test suite and coverage matrix
gwrk define tests 051-hosted-aws-pilot

# Stage 4: Task decomposition and executable bash gate scripts
gwrk define tasks 051-hosted-aws-pilot

# Autonomous phase execution in an isolated git worktree
gwrk ship 051-hosted-aws-pilot phase-01 --worktree --max-iterations 2
```
