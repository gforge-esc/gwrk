# gwrk Makefile
# Extracted from code-red to bootstrap gwrk using its own workflows.

HELP_WIDTH ?= 24

.PHONY: help agent-review-code agent-review-uat agent-plan agent-plan-to-beads agent-specify agent-analyze \
	agent-wud agent-dus agent-kill

help: ## Show available make targets with descriptions
	@printf 'Available make targets:\n'
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z0-9_.-]+:.*##/ {printf "  \\033[36m%-"$(HELP_WIDTH)"s\\033[0m %s\\n", $$1, $$2}' $(MAKEFILE_LIST)

# ─────────────────────────────────────────────────────────────
# Agent Workflows — governed Gemini CLI invocation
# ─────────────────────────────────────────────────────────────

AGENT_RUNNER ?= ./scripts/dev/agent-run.sh

agent-review-code: ## Run agent code review: make agent-review-code SPEC=001-pipeline-setup PHASE=1
	@if [ -z "$(SPEC)" ] || [ -z "$(PHASE)" ]; then \
		echo "Usage: make agent-review-code SPEC=<feature> PHASE=<n>"; \
		exit 2; \
	fi
	@$(AGENT_RUNNER) review-code $(SPEC) $(PHASE)

agent-review-uat: ## Run agent UAT review: make agent-review-uat SPEC=006-fieldnotes-explorer PHASE=3
	@if [ -z "$(SPEC)" ] || [ -z "$(PHASE)" ]; then \
		echo "Usage: make agent-review-uat SPEC=<feature> PHASE=<n>"; \
		exit 2; \
	fi
	@$(AGENT_RUNNER) review-uat $(SPEC) $(PHASE)

agent-plan: ## Run agent planning: make agent-plan SPEC=001-pipeline-setup
	@if [ -z "$(SPEC)" ]; then \
		echo "Usage: make agent-plan SPEC=<feature>"; \
		exit 2; \
	fi
	@$(AGENT_RUNNER) plan $(SPEC)

agent-plan-to-tasks: ## Generate JSON tasks and hard gates: make agent-plan-to-tasks SPEC=001-pipeline-setup
	@if [ -z "$(SPEC)" ]; then \
		echo "Usage: make agent-plan-to-tasks SPEC=<feature>"; \
		exit 2; \
	fi
	@$(AGENT_RUNNER) plan-to-tasks $(SPEC)

agent-specify: ## Run agent specification: make agent-specify SPEC=001-pipeline-setup
	@if [ -z "$(SPEC)" ]; then \
		echo "Usage: make agent-specify SPEC=<feature>"; \
		exit 2; \
	fi
	@$(AGENT_RUNNER) specify $(SPEC)

agent-analyze: ## Run agent analysis (read-only): make agent-analyze SPEC=001-pipeline-setup
	@if [ -z "$(SPEC)" ]; then \
		echo "Usage: make agent-analyze SPEC=<feature>"; \
		exit 2; \
	fi
	@$(AGENT_RUNNER) analyze $(SPEC)

agent-wud: ## Work-Until-Done: autonomous phase lifecycle (implement→review→PR→CI)
	@if [ -z "$(SPEC)" ] || [ -z "$(PHASE)" ]; then \
		echo "Usage: make agent-wud SPEC=<feature> PHASE=<n> [ISSUE=<gh_issue>]"; \
		echo "  e.g. make agent-wud SPEC=001-pipeline-setup PHASE=1 ISSUE=42"; \
		exit 2; \
	fi
	@$(AGENT_RUNNER) work-until-done $(SPEC) $(PHASE) $(ISSUE)

agent-dus: ## Define-Until-Solid: autonomous definitional lifecycle (plan-to-beads→analyze→tests→import)
	@if [ -z "$(SPEC)" ]; then \
		echo "Usage: make agent-dus SPEC=<feature> [PHASE=<n>] [SKIP_TESTS=true]"; \
		echo "  e.g. make agent-dus SPEC=001-monorepo-scaffold"; \
		exit 2; \
	fi
	@$(AGENT_RUNNER) define-until-solid $(SPEC) $(PHASE)

agent-kill: ## Kill orphaned dev processes (I-007 cleanup)
	@echo "Killing orphaned dev and cargo processes..."
	@pkill -f 'pnpm.*dev' 2>/dev/null && echo "Killed pnpm dev." || echo "No pnpm dev found."
	@pkill -f 'cargo.*run' 2>/dev/null && echo "Killed cargo run." || echo "No cargo run found."
