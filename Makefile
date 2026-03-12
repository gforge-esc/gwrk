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

# ─────────────────────────────────────────────────────────────
# Infrastructure Targets (STRICT DOCKER MANDATE)
# ─────────────────────────────────────────────────────────────

up: build ## Start the dev stack (Docker Compose)
	@docker compose --project-name gwrk-dev up -d --build
	@echo "Dev stack up: http://localhost:18790"

down: ## Stop the dev stack
	@docker compose --project-name gwrk-dev down
	@echo "Dev stack down."

ps: ## View dev stack status
	@docker compose --project-name gwrk-dev ps

logs: ## Follow dev stack logs
	@docker compose --project-name gwrk-dev logs -f

agent-kill: ## Kill orphaned local dev processes
	@pkill -f "pnpm.*dev" 2>/dev/null || true
	@pkill -f "cargo.*run" 2>/dev/null || true
	@echo "Orphaned local dev processes killed."

clean: ## Remove build artifacts and coverage output
	@rm -rf dist/ coverage/
	@echo "Cleaned dist/ and coverage/"
