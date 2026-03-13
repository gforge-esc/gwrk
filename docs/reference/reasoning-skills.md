# Compound Reasoning Skills

> Derived from [reasoning-modes.md](reasoning-modes.md). Each skill stacks 3 modes into a sequenced pass system. Skills live in `.agent/skills/` and fire on Antigravity description match. Nine skills across two domains: **definitional** (building the right thing) and **communications** (making people care).

---

## Why Compound Modes?

A single reasoning mode applied to every problem is the same mistake as using one tool for every job. gwrk's definitional workflows each have a **specific cognitive failure mode** — the mode stack for each skill is chosen to counter it.

| Failure Mode | What Goes Wrong | Counter Stack |
|---|---|---|
| Vague specs | Acceptance criteria are prose, not assertions | Reductive → Interviewer → Audit |
| Confirmation bias | You defend the first idea instead of the best one | Adversarial → Steel-man → Calibration |
| Opinion as fact | Fieldnotes contain unvalidated assertions | Forensic → Socratic → Uncertainty |
| Plan fragility | Phase ordering and sizing untested before implementation | Analytical → Pre-mortem → Comparative |
| Generic naming | Names chosen by committee instinct, not pressure | Dialectical → Aesthetic → Combinatorial |
| Artifact drift | Spec says X, plan says Y, tasks say Z | Audit → Comparative → Integrative |
| Marketing-speak | Technical audience disengages at first whiff of sell | Narrative → Subversive → Practitioner |
| Feature-listing | Complex product described as a list, not a position | Reductive → Comparative → Aesthetic |
| Audience projection | Assuming they care about what excites you | Modeling → Interviewer → Forensic |

---

## The Skills

### 1. specify-sharpen

**Modes**: Reductive + Interviewer + Audit
**Fires on**: Writing or reviewing `spec.md`, acceptance criteria, user stories, requirements
**Workflow**: `/specify`

| Pass | Mode | Action |
|---|---|---|
| 1 | **Reductive** | Strip every requirement to a testable assertion. If it can't become a shell command that exits 0/1, it's a wish |
| 2 | **Interviewer** | Generate ≤7 sharpening questions that would produce a better spec. Each answerable in ≤5 words |
| 3 | **Audit** | Map every assumption. Rate confidence 1-10. Assumptions rated ≤5 become open questions in the spec |

**Output**: Hardened spec where every `Then` clause is an executable assertion, every FR has error states, and all weak assumptions are surfaced.

---

### 2. decision-forge

**Modes**: Adversarial + Steel-man + Calibration
**Fires on**: Architecture choices, technology bets, naming decisions, prioritization calls
**Workflow**: Any `/plan` decision point or cross-cutting choice

| Pass | Mode | Action |
|---|---|---|
| 1 | **Adversarial** | Attack the proposed decision. ≤5 attack vectors ranked by damage potential |
| 2 | **Steel-man** | Build the strongest possible version of the opposing position. Must be genuinely strong |
| 3 | **Calibration** | Rate confidence per dimension. Separate known (evidence) from inferred (pattern) from assumed (convention) |

**Output**: Decision Record with survived/unresolved attack vectors, steel-man counter, confidence ratings, and reversibility cost.

---

### 3. truth-extract

**Modes**: Forensic + Socratic + Uncertainty
**Fires on**: Fieldnotes, transcripts, reference material, user interviews, competitor analysis
**Workflow**: `/discover`

| Pass | Mode | Action |
|---|---|---|
| 1 | **Forensic** | Work backward from every claim to its evidence chain. Classify as Grounded / Inferred / Asserted |
| 2 | **Socratic** | For every Asserted claim, generate the actionable question that would upgrade it to Grounded |
| 3 | **Uncertainty** | Produce a truth map separating known, inferred, and assumed with upgrade paths |

**Output**: Truth Extraction Report with grounded facts, high-confidence inferences, unvalidated assertions, and an investigative agenda.

---

### 4. architecture-stress-test

**Modes**: Analytical + Pre-mortem + Comparative
**Fires on**: Reviewing `plan.md`, phase designs, dependency ordering, phase sizing
**Workflow**: `/plan` review

| Pass | Mode | Action |
|---|---|---|
| 1 | **Analytical** | Decompose into dependency edges, critical path, blast radius per phase |
| 2 | **Pre-mortem** | Assume failure in 6 months. Trace backward to ≤5 root causes |
| 3 | **Comparative** | Evaluate against simplest, most parallel, and most conservative alternatives |

**Output**: Plan Assessment with dependency table, failure scenarios, alternatives comparison, and APPROVE/REVISE verdict.

---

### 5. naming-forge

**Modes**: Dialectical + Aesthetic + Combinatorial
**Fires on**: Product naming, CLI command naming, category definition, taxonomy design
**Workflow**: Any naming or category work

| Pass | Mode | Action |
|---|---|---|
| 1 | **Dialectical** | Thesis (strongest case for), Antithesis (strongest case against), Synthesis (what survives) |
| 2 | **Aesthetic** | Score candidates on mouth feel, visual weight, cognitive load, longevity, namespace clarity |
| 3 | **Combinatorial** | Force-connect with an unrelated domain to break default thinking and find the inevitable name |

**Output**: Naming Assessment with candidate scorecard, dialectical winner, combinatorial wild card, and final recommendation.

---

### 6. governance-audit

**Modes**: Audit + Comparative + Integrative
**Fires on**: Running `/analyze`, cross-spec review, contract compatibility, constitution compliance
**Workflow**: `/analyze`

| Pass | Mode | Action |
|---|---|---|
| 1 | **Audit** | Map every dependency across spec↔plan↔tasks↔contracts↔gates. Produce traceability matrix |
| 2 | **Comparative** | Evaluate each artifact against its governance standard (workflow quality gates), not in isolation |
| 3 | **Integrative** | Synthesize into one coherent assessment: critical path to READY, minimum changes needed |

**Output**: Governance Audit with traceability matrix, governance violations, critical path to READY, and READY/NOT READY verdict.

---

## Communications Skills

### 7. signal-cut

**Modes**: Narrative + Subversive + Practitioner
**Fires on**: Blog posts, launch announcements, social threads, demo scripts, newsletter content
**Domain**: Marketing / outward communications

| Pass | Mode | Action |
|---|---|---|
| 1 | **Narrative** | Frame as story arc: what's broken → what changes → what's possible. Must be grounded in lived experience |
| 2 | **Subversive** | Violate the expected approach for this content type. If it fits on any competitor's blog, it has failed |
| 3 | **Practitioner** | Strip everything that doesn't survive the Monday morning test. Replace claims with demonstrations |

**Output**: Content with a recognizable tension, a subversive structure, at least one concrete demonstration, and a call to action that isn't "sign up."

---

### 8. position-lock

**Modes**: Reductive + Comparative + Aesthetic
**Fires on**: Taglines, elevator pitches, positioning statements, landing page headlines, competitive comparisons
**Domain**: Messaging / positioning

| Pass | Mode | Action |
|---|---|---|
| 1 | **Reductive** | Strip to ground truth. What does this make possible that was previously impossible? One sentence |
| 2 | **Comparative** | Evaluate against status quo, closest competitor, and the category itself. Own territory competitors can't claim |
| 3 | **Aesthetic** | Optimize for ≤10 words, rhythm, memorability, and provocation |

**Output**: Position statement, competitive territory map, scored headline candidates, and final recommendation.

---

### 9. audience-model

**Modes**: Modeling + Interviewer + Forensic
**Fires on**: User personas, content strategy, demo planning, copy writing, onboarding design
**Domain**: Audience understanding

| Pass | Mode | Action |
|---|---|---|
| 1 | **Modeling** | Simulate a specific person's response — name, stack, frustration, Friday. Predict read/click/try/share |
| 2 | **Interviewer** | Surface what you don't know about them. ≤5 investigable questions |
| 3 | **Forensic** | Work backward from behavior (tools they use, content they consume, last tool they adopted), not stated preference |

**Output**: Audience Model with identity, behavioral evidence, response simulation, insight gaps, and voice calibration.

---

## Mode Reference

All 45 raw modes are catalogued in [reasoning-modes.md](reasoning-modes.md) across 7 categories:

| Category | Modes | Purpose |
|---|---|---|
| Reasoning | Analytical, Synthetic, Dialectical, Forensic, Probabilistic, Counterfactual, Reductive, Expansive | How to think |
| Evaluative | Adversarial, Steel-man, Pre-mortem, Audit, Comparative, Calibration | Finding the cracks |
| Creative | Generative, Combinatorial, Subversive, Aesthetic, Narrative, Metaphorical | Breaking the default |
| Persona | Domain Expert, Skeptic, Naive Outsider, Practitioner, Historian, Futurist, Operator, Devil's Advocate | Who's in the room |
| Communication | Teacher, Peer, Editor, Translator, Interviewer, Synthesizer | How the answer lands |
| Operational | Planning, Debugging, Optimizing, Stress-Testing, Prioritizing, Modeling | Thinking → doing |
| Meta | Socratic, Recursive, Uncertainty, Contrarian, Integrative | Prompting the prompting |
