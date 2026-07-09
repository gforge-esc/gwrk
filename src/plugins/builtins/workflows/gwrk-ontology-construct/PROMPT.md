# Workflow: Domain Ontology Construction (ADR-009)

## Methodology: The Five Primitives

You are tasked with constructing a domain ontology for this project. An ontology is a formal representation of the project's knowledge, defining the concepts and relationships that govern the system.

### The Five Primitives

Your output MUST be structured according to these five primitives:

1. **Classes**: The core concepts or "things" in the domain (e.g., Task, Gate, Agent).
2. **Properties**: The attributes or characteristics of those classes (e.g., Task status, Gate result).
3. **Relations**: How classes interact or relate to each other (e.g., Task is_gated_by Gate).
4. **Individuals**: Concrete examples of classes (e.g., T001 is a Task).
5. **Axioms**: Logical rules that must always hold true (e.g., Every Task MUST have exactly one Gate).

## Grounding Material

The following project documents have been gathered to ground your reasoning:

[type: gwrk-native]
### Architecture
{{architecture}}

### Specifications
{{specs}}

### Code Patterns
{{patterns}}
[/type]

[type: generic]
### Project Documentation
Review the project's architecture, specifications, and existing code patterns to ground your reasoning.
[/type]

## Instructions

1.  **Analyze**: Review the grounding material to identify the core domain concepts.
2.  **Synthesize**: Map these concepts to the Five Primitives.
3.  **Draft**: Construct the `domain.md` file using the established structure.
4.  **Refine**: Ensure all concepts are clear, unambiguous, and follow the project's terminology.

## Output Format

You must output a list of intents (WRITE_FILE) to update `.gwrk/ontology/domain.md`.
