# gwrk Makefile
# Local developer workflows

HELP_WIDTH ?= 15

.PHONY: help test coverage build lint format clean

help: ## Show available make targets with descriptions
	@printf 'Available make targets:\n'
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z0-9_.-]+:.*##/ {printf "  \\033[36m%-"$(HELP_WIDTH)"s\\033[0m %s\\n", $$1, $$2}' $(MAKEFILE_LIST)

# ─────────────────────────────────────────────────────────────
# Local Development Targets
# ─────────────────────────────────────────────────────────────

test: ## Run the vitest suite
	@pnpm test

coverage: ## Run the vitest suite with coverage
	@pnpm test:coverage

build: ## Compile TypeScript and run postbuild tasks
	@pnpm build

lint: ## Run Biome linter
	@pnpm lint

format: ## Run Biome auto-formatter
	@pnpm format

clean: ## Remove build artifacts and coverage output
	@rm -rf dist/ coverage/
	@echo "Cleaned dist/ and coverage/"
