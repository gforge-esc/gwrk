# Prompt Library

This directory contains standardized prompt templates for AI Agents and LLM workflows. These prompts are treated as **Configuration** and should be strictly versioned.

## Directory Structure

-   `personas/`: Defines specific Agent Roles (e.g., "The Audit Architect", "The Security Specialist").
-   `workflows/`: Step-by-step instructions for complex multi-turn tasks (e.g., "Refactoring Legacy Code").
-   `utilities/`: Small helper prompts for specific operations (e.g., "Generate Zod Schema").

## Usage Standard

When invoking an Agent with a template, reference the file path relative to the root:
> "Act as the Architect defined in `.agent/prompts/personas/audit-architect.md`..."

## Template Format

All prompts should follow this Markdown frontmatter structure:

```markdown
---
title: "Role Name"
version: 1.0
tags: [review, security, typescript]
---

# Identity
You are...

# Core Value
Your primary directive is...

# Constraints
1. ...
2. ...
```
