import type { PlanEdge, PlanFeature, PlanPhase } from "../db/plan.js";
import type { PlanSolver } from "./plan-solver.js";

export class PlanRenderer {
  constructor(
    private features: PlanFeature[],
    private phases: PlanPhase[],
    private edges: PlanEdge[],
    private solver: PlanSolver,
  ) {}

  /**
   * Render the full 000-build-plan.md content.
   */
  render(): string {
    let md = this.renderHeader();
    md += this.renderTerminology();
    md += this.renderDependencyGraph();
    md += this.renderCriticalPath();
    md += this.renderFeatures();
    md += this.renderWaveStrategy();
    md += this.renderEstimatedEffort();
    md += this.renderOpenQuestions();
    md += this.renderChangelog();
    return md;
  }

  private renderHeader(): string {
    const date = new Date().toISOString().split("T")[0];
    return `# 000 Build Plan — gwrk

> **Status:** Authoritative · **Date:** ${date}
> **Anchored to:** [architecture.md](docs/architecture.md), [GWRK-PRD-PRFAQ.md](docs/GWRK-PRD-PRFAQ.md)
> **Decisions:** [ADR-001](docs/decisions/ADR-001-task-tracking.md), [ADR-002](docs/decisions/ADR-002-sqlite-execution-ledger.md), [ADR-003](docs/decisions/ADR-003-state-contract.md), [ADR-004](docs/decisions/ADR-004-agent-native-output.md), [ADR-005](docs/decisions/ADR-005-tdd-gate-architecture.md), [ADR-006](docs/decisions/ADR-006-plugin-agent-backends.md)

---

`;
  }

  private renderTerminology(): string {
    return `## Terminology

| Term | Meaning | Example |
|---|---|---|
| **Feature** | A spec subdirectory under \`specs/\`. Has its own spec.md, plan.md, contracts/, gates/, etc. | \`specs/001-cli-core/\` = Feature 001 |
| **Phase** | An implementation stage *within* a feature's \`plan.md\`. A feature has 1+ phases. | Phase 1 of Feature 013 = "Foundation (7 SP)" |
| **Wave** | A scheduling group of features that can execute concurrently. | Wave 2 = {F013, F006, F007, F012} |

---

`;
  }

  private renderDependencyGraph(): string {
    let md = "## Dependency Graph\n\n```mermaid\ngraph TD\n";

    // Group edges by from_id to make it cleaner
    for (const edge of this.edges) {
      const fromF = this.features.find((f) => f.id === edge.from_id);
      const toF = this.features.find((f) => f.id === edge.to_id);

      const fromLabel = this.getFeatureLabel(edge.from_id);
      const toLabel = this.getFeatureLabel(edge.to_id);

      md += `    ${fromLabel} --> ${toLabel}\n`;
    }

    // Add styles for status
    for (const f of this.features) {
      if (f.status === "DONE" || f.status === "SHIPPED") {
        md += `    style ${f.id} fill:#22cc22,stroke:#118811,color:#fff\n`;
      } else if (f.status === "IN_PROGRESS") {
        md += `    style ${f.id} fill:#ffaa00,stroke:#cc8800,color:#000\n`;
      }
    }

    md += "```\n\n---\n\n";
    return md;
  }

  private getFeatureLabel(id: string): string {
    const f = this.features.find((f) => f.id === id);
    if (!f) return id;

    let icon = "";
    if (f.status === "DONE") icon = " ✅";
    else if (f.status === "SHIPPED") icon = " ✅";
    else if (f.status === "SPECIFIED" || f.status === "DEFINED") icon = " 🟡";
    else if (f.status === "IN_PROGRESS") icon = " 🔴";

    const label = f.name !== f.id ? `${f.id}: ${f.name}` : f.id;
    return `${f.id}["${label}${icon}"]`;
  }

  private renderCriticalPath(): string {
    const { path } = this.solver.getCriticalPath();
    if (path.length === 0) return "";

    let md =
      "## Critical Path\n\n```mermaid\ngantt\n    title Critical Path\n    dateFormat X\n    axisFormat %s\n\n";

    let lastId = "0";
    for (const p of path) {
      const status =
        p.status === "DONE" || p.status === "SHIPPED"
          ? "done"
          : p.status === "IN_PROGRESS"
            ? "active"
            : "";
      const id = p.id.replace(/[^a-zA-Z0-9]/g, "_");
      const duration = p.sp_estimate || 1;

      md += `    ${p.name.padEnd(25)} :${status}, ${id}, ${lastId === "0" ? "0" : `after ${lastId}`}, ${duration}\n`;
      lastId = id;
    }

    md += "```\n\n---\n\n";
    return md;
  }

  private renderFeatures(): string {
    let md = "## Features\n\n";

    for (const f of this.features) {
      let icon = "⚪";
      if (f.status === "DONE") icon = "✅";
      else if (f.status === "SHIPPED") icon = "✅";
      else if (f.status === "IN_PROGRESS") icon = "🔴";
      else if (f.status === "SPECIFIED" || f.status === "DEFINED") icon = "🟡";
      else if (f.status === "RETIRED") icon = "⚫";

      const heading = f.name !== f.id ? `${f.id} — ${f.name}` : f.id;
      md += `### Feature ${heading} ${icon}\n\n`;

      if (f.status === "SHIPPED") {
        md +=
          "> [!WARNING]\n> **Status:** ⚠️ Shipped but not yet TDD-hardened or verified.\n\n";
      } else {
        md += `**Status:** ${f.status}\n\n`;
      }

      const phases = this.phases
        .filter((p) => p.feature_id === f.id)
        .sort((a, b) => a.seq - b.seq);
      if (phases.length > 0) {
        md += "| Phase | Name | Status | SP |\n";
        md += "|---|---|---|---|\n";
        for (const p of phases) {
          let pIcon = "⚪";
          if (p.status === "DONE" || p.status === "SHIPPED") pIcon = "✅";
          else if (p.status === "IN_PROGRESS") pIcon = "🔴";

          md += `| ${p.seq} | ${p.name} | ${p.status} ${pIcon} | ${p.sp_estimate} |\n`;
        }
        md += "\n";
      }
    }

    md += "---\n\n";
    return md;
  }

  private renderWaveStrategy(): string {
    const waves = this.solver.getTopologicalWaves();
    let md = "## Wave Strategy\n\n";
    md += "| Wave | Features | Theme |\n";
    md += "|---|---|---|\n";

    waves.forEach((wave, i) => {
      const featureIds = Array.from(
        new Set(wave.map((p) => p.feature_id)),
      ).join(", ");
      md += `| Wave ${i + 1} | ${featureIds} | TBD |\n`;
    });

    md += "\n---\n\n";
    return md;
  }

  private renderEstimatedEffort(): string {
    let md = "## Estimated Effort\n\n";
    md += "| Feature | SP | Status |\n";
    md += "|---|---|---|\n";

    let totalSp = 0;
    for (const f of this.features) {
      const sp =
        f.sp_total ||
        this.phases
          .filter((p) => p.feature_id === f.id)
          .reduce((sum, p) => sum + p.sp_estimate, 0);
      md += `| ${f.id} | ${sp} | ${f.status} |\n`;
      totalSp += sp;
    }
    md += `| **Total** | **${totalSp}** | |\n`;

    md += "\n---\n\n";
    return md;
  }

  private renderOpenQuestions(): string {
    return `## Open Questions

| # | Question | Status |
|---|---|---|
| 1 | TBD | 🟡 Open |

---

`;
  }

  private renderChangelog(): string {
    const date = new Date().toISOString().split("T")[0];
    return `## Changelog

- **${date}:** Regenerated from graph state via \`gwrk plan render\`.
`;
  }
}
