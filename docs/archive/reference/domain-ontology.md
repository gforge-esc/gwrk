# Domain Ontology

> How to structure knowledge before writing code, specs, or prompts.

An ontology is not a schema. A schema describes the **shape** of data. An ontology describes the **meaning** of a domain — what exists, how things relate, and what rules govern valid states. Every spec, every plan, every skill in gwrk implicitly contains a domain ontology. This document makes that explicit.

---

## Why This Exists

The failure mode in knowledge work is **flat thinking** — treating a domain as a bag of nouns when it is actually a graph of typed relationships with constraints. When you skip the ontology, you get:

- Specs with undefined terms that mean different things to different people
- Plans that miss dependency edges because the domain model is in someone's head
- Skills that hallucinate categories because no one mapped the taxonomy first
- Data models that conflate classes with instances (e.g., "Employee" the concept vs. "John Doe" the person)

**An ontology is the prerequisite to specification.** You can't sharpen a spec if you haven't agreed on what the words mean.

---

## The Five Primitives

Every domain ontology — from a startup's product model to a 10,000-class biomedical taxonomy — is built from exactly five primitives.

### 1. Classes (Concepts)

The categories of things that exist in your domain. Not instances — *kinds*.

> "WHAT ARE THE KINDS OF THINGS THAT EXIST IN THIS DOMAIN? NOT EXAMPLES — CATEGORIES."

- **Employee**, **Department**, **Project** — not John, HR, or Phoenix
- Classes can have subclasses (inheritance): `SoftwareEngineer` is-a `Employee`
- A class is valid only if you can point to at least two distinguishable instances
- If you can't name the boundary between two classes, they might be one class

| Question | Purpose |
|----------|---------|
| What are the top-level concepts? | Identify domain scope |
| What specializations exist? | Build class hierarchy |
| What concept am I conflating? | Split overloaded classes |
| What concept is missing? | Surface implicit knowledge |

### 2. Properties (Attributes)

The characteristics that describe a class or its instances. Properties have **types** and **constraints**.

> "WHAT DO YOU NEED TO KNOW ABOUT EACH THING TO TELL THEM APART?"

- **Intrinsic**: `Employee.name`, `Employee.hire_date` — properties of the thing itself
- **Derived**: `Employee.tenure` — computed from other properties (hire_date → now)
- **Extrinsic**: `Employee.desk_number` — properties imposed by context, not essence

| Property Type | Example | Volatility |
|---------------|---------|-----------|
| Identifier | `employee_id` | Immutable |
| Intrinsic | `name`, `date_of_birth` | Low |
| State | `status` (active/inactive) | Medium |
| Derived | `years_of_service` | Computed |
| Extrinsic | `parking_spot` | High |

### 3. Relations (Connections)

The typed edges between classes. The verbs of your domain. Relations have **cardinality**, **directionality**, and **constraints**.

> "WHAT VERBS CONNECT YOUR NOUNS? WHAT IS THE DIRECTION? WHAT ARE THE LIMITS?"

- `Employee` **works_in** `Department` (many-to-one)
- `Employee` **manages** `Employee` (one-to-many, reflexive)
- `Project` **requires** `Skill` (many-to-many)

| Relation Property | Example | Why It Matters |
|-------------------|---------|---------------|
| Cardinality | 1:N, M:N | Determines data structure |
| Direction | Employee → Department | Ownership and traversal |
| Required/Optional | Must have dept? | Constraint enforcement |
| Reflexive | manages self? | Hierarchy modeling |
| Transitive | reports_to chain | Inference capability |
| Inverse | works_in ↔ employs | Bidirectional navigation |

### 4. Individuals (Instances)

The concrete, named members of your classes. The data, not the model.

> "GIVE ME THREE EXAMPLES OF EACH CLASS. IF YOU CAN'T, THE CLASS ISN'T REAL."

- `John Doe` is an individual of class `Employee`
- `Engineering` is an individual of class `Department`
- Individuals validate your class model — if an instance doesn't fit, your classes are wrong
- If two individuals of the same class behave fundamentally differently, you need a subclass

### 5. Axioms (Rules)

The constraints that define valid states. What must always be true, what can never be true, and what follows from what.

> "WHAT RULES GOVERN THIS DOMAIN THAT CANNOT BE VIOLATED WITHOUT THE MODEL BEING WRONG?"

- **Disjointness**: An `Employee` cannot simultaneously be a `Department`
- **Exhaustiveness**: Every `Project` must have exactly one `ProjectLead`
- **Transitivity**: If A `reports_to` B and B `reports_to` C, then A `reports_to` C
- **Domain/Range**: `manages` can only connect `Employee` → `Employee`, not `Employee` → `Building`
- **Cardinality**: A `Department` must have ≥1 `Employee`

| Axiom Type | Example | What It Prevents |
|-----------|---------|-----------------|
| Disjointness | Employee ≠ Department | Category confusion |
| Existential | Every Project has a Lead | Orphan instances |
| Universal | All Employees have an ID | Missing identifiers |
| Cardinality | Dept has 1..N Employees | Empty containers |
| Transitivity | reports_to chains | Broken hierarchies |
| Symmetry | collaborates_with | One-sided relations |

---

## Representation Formats

Ontologies are designed to be both human-readable and machine-interpretable. Choose your format based on your purpose.

### For Machine Reasoning

| Format | What It Is | When to Use |
|--------|-----------|-------------|
| **OWL** (Web Ontology Language) | W3C standard for semantic web. Full logic, class hierarchies, property restrictions, inference | When you need automated reasoning, consistency checking, or formal verification |
| **RDF** (Resource Description Framework) | Everything is a triple: `Subject → Predicate → Object`. Serialized as Turtle, JSON-LD, or XML | When you need interoperability, linked data, or SPARQL queries |
| **SKOS** (Simple Knowledge Organization) | Lightweight vocabulary for taxonomies and thesauri. Concepts + labels + broader/narrower | When you need a controlled vocabulary, not a full ontology |

### For Human Collaboration

| Format | What It Is | When to Use |
|--------|-----------|-------------|
| **Markdown tables** | Classes, properties, relations as tables (this document) | Early domain modeling, spec discussions, skill definitions |
| **Mermaid diagrams** | Class diagrams and entity relationships in code | Architecture docs, plan.md files, visual communication |
| **Property graphs** (Neo4j, etc.) | Nodes and edges with properties. Traversal-optimized | When you need to query relationship patterns at scale |

### For gwrk

gwrk operates at the **markdown table** and **Mermaid** tier. Ontologies in gwrk are captured as:

1. **Glossary tables** in `spec.md` — defining terms before using them
2. **Class diagrams** in `plan.md` — showing structure before building
3. **Axiom lists** in acceptance criteria — encoding rules as testable assertions
4. **Relation maps** in skill SKILL.md files — declaring how concepts connect in a domain

You don't need Protégé. You need a table with five columns: Class, Property, Type, Constraint, Example.

---

## Building a Domain Ontology

### Step 1 — Scope the Domain

Define the boundary. What's in, what's out, what's adjacent.

- **In scope**: What questions must this ontology answer?
- **Out of scope**: What related domains are we deliberately not modeling?
- **Adjacent**: What external ontologies do we touch but not own?

> "WHAT QUESTIONS MUST THIS MODEL BE ABLE TO ANSWER? ANYTHING IT CAN'T ANSWER IS OUT OF SCOPE."

### Step 2 — Extract the Nouns

From source material (transcripts, fieldnotes, existing specs, user interviews), extract every noun. Group synonyms. Eliminate duplicates. Promote to classes.

| Raw Noun | Synonym Group | Promoted Class |
|----------|--------------|----------------|
| developer, eng, engineer | engineer | `SoftwareEngineer` |
| repo, codebase, project | repository | `Repository` |
| PR, merge request, change | pull request | `PullRequest` |

### Step 3 — Extract the Verbs

From the same source material, extract every verb that connects nouns. These become your relations.

| Raw Verb | Normalized Relation | Domain → Range | Cardinality |
|----------|-------------------|---------------|-------------|
| writes, authors | `authors` | Engineer → PullRequest | 1:N |
| reviews, approves | `reviews` | Engineer → PullRequest | N:N |
| merges into | `merges_to` | PullRequest → Branch | N:1 |

### Step 4 — Define the Axioms

For each class and relation, ask: what must always be true?

- Every `PullRequest` must have exactly one `author`
- A `PullRequest` cannot be both `open` and `merged`
- `reviews` is irreflexive: you cannot review your own PR (or can you? — this is where the domain expert earns their keep)

### Step 5 — Validate with Instances

Instantiate your ontology with 3-5 concrete individuals per class. Walk them through every relation and axiom. Where it breaks, the model is wrong.

---

## Failure Modes

| Failure | Symptom | Remedy |
|---------|---------|--------|
| **Overloading** | One class does three jobs | Split into subclasses |
| **Undergeneralizing** | Ten classes that are really one with a type property | Merge + add discriminator |
| **Missing middle** | Two classes connected by a verb that should be a class itself | Reify the relation |
| **Assumption burial** | Constraint exists in developer's head, not in the model | Extract as axiom |
| **Synonym collision** | Same word means different things in different contexts | Glossary + namespace |
| **Instance/Class confusion** | "HR" appears as both a department name and a department type | Separate class from individual |

---

## Ontology vs. Adjacent Concepts

| Concept | What It Does | Relationship to Ontology |
|---------|-------------|------------------------|
| **Schema** | Defines data shape (columns, types) | Implements the ontology's properties |
| **Taxonomy** | Hierarchical classification | Subset of ontology (classes + is-a only) |
| **Glossary** | Term definitions | Flat ontology (classes + definitions, no relations) |
| **Knowledge Graph** | Instance-level graph of facts | Ontology populated with individuals |
| **Data Model** | Storage-optimized structure (ERD, DDL) | Ontology projected into a database |
| **Specification** | Behavioral requirements | Ontology + desired state changes |

---

## How to Use This

### For Spec Authors

Before writing FR-001, write the glossary. Use the five primitives to check:
- Did I define every class I'm using?
- Did I declare every relation's cardinality?
- Did I encode my axioms as acceptance criteria?

### For Plan Authors

Before sizing phases, draw the class diagram. Use it to check:
- Are my phase boundaries aligned with class boundaries?
- Do I have cross-class dependencies that create coupling?
- Am I building classes before the relations that connect them?

### For Skill Authors

Before writing SKILL.md, map the domain the skill operates in:
- What classes does this skill consume and produce?
- What relations does the skill traverse?
- What axioms must the skill preserve?

### For Discovery

When processing fieldnotes or transcripts, use the ontology as an extraction template:
- Every new noun → candidate class
- Every new verb → candidate relation
- Every "always" / "never" / "must" → candidate axiom

---

## Compound Skills Derived from This

| Skill | Modes | When It Fires |
|-------|-------|---------------|
| **domain-map** | Analytical + Interviewer + Audit | Modeling a new domain, building glossaries, defining taxonomies, or any work where the terms must be agreed before the spec can begin |
| **ontology-validate** | Forensic + Comparative + Stress-Testing | Reviewing an existing domain model, checking for overloaded classes, missing relations, buried assumptions, or validating that a schema correctly implements the ontology |

> See `~/.gwrk/plugins/skills/domain-map/` and `~/.gwrk/plugins/skills/ontology-validate/` for the full skill definitions.
