# Seeding Governance

## Architecture Reference
See `docs/architecture.md` §9 for the Golden-Hash Testing strategy.

## Source of Truth

The **Golden-Hash Fixture Corpus** is the source of truth for test data.
- **Location**: `fixtures/` (repo root)
- **Format**: Synthetic code file pairs with expected diff output hashes.
- **Prohibited**: Do NOT use real case files. All test data must be synthetic.

## Fixture Structure

```
fixtures/
├── java-pair-001/
│   ├── source/          # Known "original" Java files
│   ├── target/          # Known "copied/modified" Java files
│   ├── settings.json    # Engine settings for this comparison
│   └── expected.json    # Expected SHA256 of diff output
├── typescript-pair-001/
│   ├── source/
│   ├── target/
│   ├── settings.json
│   └── expected.json
└── README.md            # Corpus documentation
```

## Workflow

To update the fixture corpus:
1. **Create synthetic files**: Write code pairs that demonstrate specific patterns (copy, move, rename, modify).
2. **Run engine**: `@codered/engine` processes the pair with defined settings.
3. **Capture hash**: Record `SHA256(output)` in `expected.json`.
4. **Commit**: Commit the fixture and expected hash.

## Determinism Contract

Every CI run asserts:
```
SHA256(engine.compare(source, target, settings)) == expected.json.hash
```

If this assertion fails, the PR is **automatically rejected**. The engine is non-deterministic.

## Idempotency

Fixture processing MUST be idempotent. Same input + same settings = same output hash. Always.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 2.0 | 2026-02-21 | Rewritten for CodeRed golden-hash fixture model. |
| 1.0 | — | Initial GForge version (deprecated for CodeRed) |
