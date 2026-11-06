# 032 — Language-Agnostic Build, Test, and Gate ToolchainPort

> **Status:** Defined · **Anchored to:** ADR-005, ADR-011

## 1. Problem
`gwrk test`, `gate-gen.ts`, `ship.ts`, `ship-orchestrator.ts`, `test-discovery.ts`, `test-runner.ts`, `test-activator.ts`, and `file-extract.ts` hardcode TypeScript, `pnpm build`, and `pnpm vitest run`, preventing Python, Go, and Rust projects from running through `gwrk`.

## 2. Functional Requirements
- **FR-001:** `src/ports/toolchain-port.ts` MUST provide language-agnostic build, test, file classification, test discovery, and test activation for TypeScript, Python, Go, and Rust.
- **FR-002:** `gwrk test` (`src/commands/test.ts`) MUST route through `detectProfile`, `discoverTestsForSources`, and `runTests`.
- **FR-003:** `gate-gen.ts` MUST emit profile-aware build and test commands instead of hardcoded `pnpm build` and `pnpm vitest run`.
- **FR-004:** `test-discovery.ts` MUST NOT match a Python source file (`src/foo.py`) as its own test file and MUST discover `test_*.py`, `*_test.py`, `*_test.go`, and `tests/*.rs`.
- **FR-005:** `parseTestOutput` in `test-runner.ts` MUST parse `go test` output (`--- PASS:`, `--- FAIL:`, `ok <pkg>`), and `activatePhaseTests` MUST un-skip `pytest.mark.skip`, `#[ignore]`, and `t.Skip()`.
