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

## Why

Without a domain ontology, agents produce concept mush: they use synonyms interchangeably when they are distinct domain concepts, they confuse instances with classes, and they bury assumptions that should be explicit constraints. The ontology eliminates these failures by giving agents a shared vocabulary with crisp boundaries.

## Scope Constraints

- MUST focus on the project's domain language and conceptual structure.
[type: gwrk-native]
- MUST produce output that fits in `.gwrk/ontology/domain.md` (the ADR-009 injection point).
[/type]
[type: generic]
- MUST produce a structured domain model in markdown format.
[/type]
- MUST align with existing project documentation, code,decisions, and specs.
- MUST NOT speculate on implementation details or propose code changes.
- MUST NOT produce a generic ontology; every class must serve this specific project.

## Algorithm: Five-Primitive Ontology Construction

Construct the ontology using five primitives:

### Primitive 1: Classes (Concepts)

The categories of things that exist in this domain (kinds, not instances).

**Validation rule**: A class is valid only if you can point to at least three distinguishable instances and trace the class to at least one source artifact. If you cannot name the boundary between two classes, they are one class.

For each class, define:
- **Name** (PascalCase)
- **Definition** (one precise sentence)
- **Boundary test** (what this class is NOT: the adjacent concept it must not be confused with)
- **Example individuals** (3 to 5 concrete instances that validate the class)
- **Source** (repo file path, spec, or ADR where the concept is grounded)

### Primitive 2: Properties (Attributes)

The characteristics that describe a class. Every class in `## Classes` MUST have at least one property in `## Properties`. Classify each property by volatility (`Kind`):
- **identifier**: immutable (UUID, slug, numeric prefix)
- **intrinsic**: low volatility, changes rarely (name, kind, story points)
- **state**: medium volatility, changes with lifecycle (status, phase, exit code)
- **derived**: computed from other properties (compression ratio, pass rate)
- **extrinsic**: context-dependent, not owned by the class (assigned backend, active worktree)

### Primitive 3: Relations (Connections)

The typed edges between classes. Do not list both directions of the same relationship as separate rows; record one primary row and name its inverse in the `Inverse` column. Every relation must specify:
- **Relation** (verb phrase in `snake_case`)
- **Domain** (source class)
- **Range** (target class)
- **Cardinality** (`1:1`, `1:N`, `N:1`, `M:N`)
- **Direction** (`unidirectional` or `bidirectional`)
- **Inverse** (the relation read from Range back to Domain)
- **Required?** (`Y` or `N`)

### Primitive 4: Individuals (Instances)

3 to 5 concrete, named members per class:
- If an instance does not fit any class, the model has a gap.
- If two individuals of the same class behave differently across relations, split out a subclass.
- Walk each individual through the relations; every connection must hold.

### Primitive 5: Axioms (Rules)

What must always be true, what can never be true, and what follows from what.

Axiom types:
- **Disjointness**: X is never Y (prevents concept confusion)
- **Existential**: every X must have at least one Y
- **Universal**: all X must satisfy predicate P
- **Cardinality**: X has N of Y
- **Conditional**: if X then Y

For each axiom, state:
- **ID** (`AX-001`, `AX-002`, ...)
- **Type** (`Disjointness`, `Existential`, `Universal`, `Cardinality`, `Conditional`)
- **Rule** (plain English statement using `MUST` or `MUST NOT`)
- **What It Prevents** (the specific failure mode this axiom blocks)

## Failure Mode Checklist

Validate against all six failure modes before finalizing:

1. **Overloading**: One class doing three jobs. Split it.
2. **Undergeneralizing**: Multiple concepts that are one class with a `kind` property. Merge them.
3. **Missing middle**: A relation that carries state of its own. Reify the verb into a noun class.
4. **Assumption burial**: A rule in someone's head instead of in the model. Extract it as an axiom.
5. **Synonym collision**: Same word used with different meanings across contexts. Resolve in the glossary.
6. **Instance/class confusion**: A concrete example modeled as a class, or a class modeled as an instance.

## Construction Steps

1. **Scope the domain**: Read the project's architecture, specifications, decisions, and code patterns. Define what is in-scope, out-of-scope, and adjacent.
2. **Extract the nouns**: Identify candidate classes from source material. Promote only those with at least 3 distinguishable instances and a clear source artifact.
3. **Define properties**: Assign at least one typed property (`identifier`, `intrinsic`, `state`, `derived`, `extrinsic`) to every class.
4. **Extract the verbs**: Connect classes with typed relations. Specify cardinality, direction, and inverse name without duplicating inverse pairs as separate rows.
5. **Define the axioms**: State what must always or never be true, classified by axiom type. Every axiom must name the failure it prevents.
6. **Validate with individuals**: List 3 to 5 concrete individuals per class and verify they satisfy the relations and axioms.
7. **Build the glossary and excluded concepts**: Resolve every ambiguous or overloaded term in `## Glossary`, and document candidate concepts deliberately left out in `## Excluded Concepts`.

## Self-Reflection (Before Output)

Verify all seven checks before emitting output:

1. Can you trace every Class back to at least one source artifact in the `Source` column?
2. Does every Class have at least one Property in `## Properties` and 3 to 5 distinguishable Individuals?
3. Does every Relation have explicit Cardinality, Direction, and Inverse name (with no duplicate inverse rows)?
4. Have you checked all six failure modes?
5. Can the ontology answer the in-scope questions defined in Step 1?
6. Does the Glossary resolve every ambiguous or overloaded term?
7. Are concepts you chose NOT to include documented in `## Excluded Concepts`?

## Output Format

Produce a single markdown file in the ADR-009 format:

```markdown
# Domain Ontology: [Project Name]

## Scope
- **In-scope**: [what the ontology covers]
- **Out-of-scope**: [what it excludes]
- **Adjacent**: [related domains that touch but are not modeled]

## Classes
| Class | Definition | Boundary Test | Example Individuals | Source |
|---|---|---|---|---|
| [PascalCase] | [one sentence] | Not a [confused concept] | [3-5 instances] | [file/spec/ADR path] |

## Properties
| Class | Property | Kind | Description | Constraint |
|---|---|---|---|---|
| [Class] | [name] | [identifier/intrinsic/state/derived/extrinsic] | [description] | [enum, range, format] |

## Relations
| Relation | Domain | Range | Cardinality | Direction | Inverse | Required? |
|---|---|---|---|---|---|---|
| [snake_case] | [SourceClass] | [TargetClass] | [1:1/1:N/N:1/M:N] | [unidirectional/bidirectional] | [inverse_name] | [Y/N] |

## Individuals
| Class | Individual | Description |
|---|---|---|
| [Class] | [instance_id] | [concrete member and how it instantiates the class] |

## Axioms
| ID | Type | Rule | What It Prevents |
|---|---|---|---|
| AX-001 | [Disjointness/Existential/Universal/Cardinality/Conditional] | [plain English rule] | [failure mode blocked] |

## Glossary
| Term | Canonical Meaning | Must Not Be Confused With |
|---|---|---|
| [term] | [definition] | [disambiguation] |

## Excluded Concepts
| Concept | Why Excluded |
|---|---|
| [concept] | [reason it is a property, instance, out-of-scope concern, or synonym] |
```

[type: gwrk-native]
## Intent Generation

After constructing the ontology, generate `WRITE_FILE` intents to:
1. Create `.gwrk/ontology/` directory if it does not exist
2. Write `domain.md` to `.gwrk/ontology/domain.md`

The file must be standalone: no external dependencies, no imports, and no links to files that may not exist. It is injected verbatim into agent prompts as `<domain_ontology>` context.
[/type]

[type: generic]
## Intent Generation

After constructing the ontology, generate `WRITE_FILE` intents to:
1. Create a `docs/ontology/` or `.gwrk/ontology/` directory if it does not exist
2. Write `domain.md` to the selected directory.
[/type]
