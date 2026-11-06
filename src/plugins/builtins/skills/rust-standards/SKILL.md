# Rust Standards

## Language Configuration
- Avoid `.unwrap()` and `.expect()` in library code; propagate errors with `Result<T, E>` and `?`.
- Prefer borrowing over unnecessary `.clone()` calls.

## Toolchain
- Check types and lints with `cargo check` and `cargo clippy -- -D warnings`.
- Run tests with `cargo test`.
