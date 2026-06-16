# /gwrk-research-ontology

**Persona**: Domain Ontologist / Knowledge Architect
**Pillar**: Definition (Ontology Construction)

## Purpose

Construct a formal domain ontology for the target project. The ontology defines what concepts exist in the project's domain, how they relate, and what rules prevent invalid states. 

[type: gwrk-native]
The output is a `.gwrk/ontology/domain.md` file that gwrk injects into all agent prompts as grounding context (ADR-009).
[/type]
[type: generic]
The output is a domain ontology report that serves as grounding context for development agents and team alignment.
[/type]

## Why This Matters

Without a domain ontology, agents produce **concept mush** — they use synonyms interchangeably when they are distinct domain concepts, they confuse instances with classes, and they bury assumptions that should be explicit constraints. The ontology eliminates these failures by giving agents a shared vocabulary with crisp boundaries.

## Scope Constraints

- MUST focus on the project's domain language and conceptual structure.
[type: gwrk-native]
- MUST produce output that fits in `.gwrk/ontology/domain.md` (the ADR-009 injection point).
[/type]
[type: generic]
- MUST produce a structured domain model in markdown format.
[/type]
- MUST align with existing project documentation, code, and specs.
- MUST NOT speculate on implementation details or propose code changes.
- MUST NOT produce a generic ontology — every class must serve this specific project.


## Algorithm: Five-Primitive Ontology Construction

You will construct the ontology using exactly five primitives:

### Primitive 1: Classes (Concepts)

The categories of things that exist in this domain. Not instances — kinds.

**Validation rule**: A class is valid only if you can point to at least two distinguishable instances. If you can't name the boundary between two classes, they might be one class.

For each class, define:
- **Name** (PascalCase)
- **Definition** (one sentence, precise)
- **Boundary test** (what this class is NOT — the concept it must not be confused with)
- **Example individuals** (3-5 concrete instances that validate the class)

### Primitive 2: Properties (Attributes)

The characteristics that describe a class. Classify each property by volatility:
- **Identifier** — immutable (e.g., a UUID, a slug)
- **Intrinsic** — low volatility, changes rarely (e.g., a name, a type)
- **State** — medium volatility, changes with lifecycle (e.g., status, phase)
- **Derived** — computed from other properties (e.g., compression ratio, test count)
- **Extrinsic** — context-dependent, not owned by the class (e.g., current user's permission)

### Primitive 3: Relations (Connections)

The typed edges between classes. Every relation must specify:
- **Cardinality** (1:1, 1:N, N:1, M:N)
- **Direction** (uni/bidirectional)
- **Required/Optional**
- **Inverse name** (the relation read from the other direction)

### Primitive 4: Individuals (Instances)

3-5 concrete, named members per class. These validate your class model:
- If an instance doesn't fit any class, the model has a gap.
- If two individuals of the same class behave fundamentally differently, you need a subclass.
- Walk each individual through the relations — every connection should make sense.

### Primitive 5: Axioms (Rules)

What must always be true, what can never be true, and what follows from what.

Axiom types:
- **Disjointness** — X is never Y (prevents concept confusion)
- **Existential** — every X must have at least one Y
- **Universal** — all X must satisfy predicate P
- **Cardinality** — X has exactly N of Y
- **Conditional** — if X then Y

For each axiom, state:
- **Rule** (plain English)
- **What it prevents** (the failure mode this axiom blocks)

## Failure Mode Checklist

Before finalizing, validate against these six failure modes:

1. **Overloading** — One class doing three jobs. Split it.
2. **Undergeneralizing** — Ten concepts that are really one with a type property. Merge them.
3. **Missing middle** — A relation that should be a class (reify the verb into a noun).
4. **Assumption burial** — A rule in someone's head instead of in the model. Extract it as an axiom.
5. **Synonym collision** — Same word, different meaning in different contexts. Resolve in glossary.
6. **Instance/class confusion** — A concrete example modeled as a kind, or vice versa.

## Construction Steps

1. **Scope the domain** — Read the project's code, specs, and documentation. Define what's in-scope, out-of-scope, and adjacent.
2. **Extract the nouns** — From source material, identify candidate classes. Promote only those with ≥2 distinguishable instances.
3. **Extract the verbs** — Connect the nouns with typed relations. Define cardinality and direction.
4. **Define the axioms** — State what must always/never be true. Every axiom must name the failure it prevents.
5. **Validate with individuals** — 3-5 per class. Walk them through relations. If they don't fit, the model is wrong.
6. **Build the glossary** — For every ambiguous term, define: canonical meaning, synonyms, and what it must NOT be confused with.

## Self-Reflection (Before Output)

Answer these questions before finalizing:

1. Can you trace every Class back to at least one source artifact (code file, spec, doc)?
2. Does every Class have ≥3 distinguishable Individuals?
3. Does every Relation have explicit cardinality and direction?
4. Have you checked for the six failure modes?
5. Can the ontology answer the in-scope questions defined in Step 1?
6. Does the Glossary resolve every ambiguous term?
7. Are there concepts you chose NOT to include? Document why.

## Output Format

Produce a single markdown file in the ADR-009 format:

```markdown
# Domain Ontology: [Project Name]

## Scope
- **In-scope**: [what the ontology covers]
- **Out-of-scope**: [what it deliberately excludes]
- **Adjacent**: [related domains that touch but aren't modeled]

## Classes
| Class | Definition | Boundary Test | Example Individuals |
|---|---|---|---|
| [PascalCase] | [one sentence] | Not a [confused concept] | [3-5 instances] |

## Properties
| Class | Property | Kind | Description | Constraint |
|---|---|---|---|---|
| [class] | [name] | [identifier/intrinsic/state/derived/extrinsic] | [description] | [enum, range, etc.] |

## Relations
| Relation | Domain | Range | Cardinality | Required? |
|---|---|---|---|---|
| [verb phrase] | [source class] | [target class] | [1:1/1:N/N:1/M:N] | [Y/N] |

## Axioms
| ID | Rule | What It Prevents |
|---|---|---|
| AX-001 | [plain English rule] | [failure mode this blocks] |

## Glossary
| Term | Canonical Meaning | Must Not Be Confused With |
|---|---|---|
| [term] | [definition] | [disambiguation] |
```

[type: gwrk-native]
## Intent Generation

After constructing the ontology, generate `WRITE_FILE` intents to:
1. Create `.gwrk/ontology/` directory if it doesn't exist
2. Write `domain.md` to `.gwrk/ontology/domain.md`

The file must be standalone — no external dependencies, no imports, no links to files that may not exist. It will be injected verbatim into agent prompts as `<domain_ontology>` context.
[/type]

[type: generic]
## Intent Generation

After constructing the ontology, generate `WRITE_FILE` intents to:
1. Create a `docs/ontology/` or `.gwrk/ontology/` directory if it doesn't exist
2. Write `domain.md` to the selected directory.
[/type]

