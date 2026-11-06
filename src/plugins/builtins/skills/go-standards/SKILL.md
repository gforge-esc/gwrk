# Go Standards

## Language Configuration
- Handle every returned error explicitly.
- Wrap errors with `%w` and contextual prefix.
- Keep package names lowercase, single-word, and singular.

## Toolchain
- Verify compilation with `go build ./...` and static analysis with `go vet ./...`.
- Run tests with `go test ./...`.
