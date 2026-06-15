import fs from "node:fs";
import yaml from "yaml";

export interface ParsedPlan {
  features: PlanFeaturePayload[];
  phases: PlanPhasePayload[];
  edges: PlanEdgePayload[];
}

export interface PlanFeaturePayload {
  id: string;
  name: string;
  status: string;
  sp_total: number;
}

export interface PlanPhasePayload {
  id: string;
  feature_id: string;
  name: string;
  status: string;
  health: string;
  sp_estimate: number;
  seq: number;
}

export interface PlanEdgePayload {
  from_id: string;
  to_id: string;
  edge_type: string;
}

/**
 * Parse 000-build-plan.md (Markdown + Mermaid) or a YAML seed payload.
 */
export function parseBuildPlan(filePath: string): ParsedPlan {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Build plan file not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, "utf-8");

  // If it's a known seed payload or contains multiple YAML blocks
  if (
    filePath.endsWith("seed-payload.md") ||
    (content.includes("id: F000") && content.includes("---"))
  ) {
    return parseYamlSeed(content);
  }

  return parseMarkdownPlan(content);
}

/**
 * Parse the human-readable 000-build-plan.md
 */
function parseMarkdownPlan(content: string): ParsedPlan {
  const features: PlanFeaturePayload[] = [];
  const phases: PlanPhasePayload[] = [];
  const edges: PlanEdgePayload[] = [];

  // 1. Parse Mermaid for edges
  // graph TD
  // F000["F000: Extraction ✅"] --> F001["F001: CLI Core ✅"]
  const mermaidMatch = content.match(/```mermaid[\s\S]*?graph TD([\s\S]*?)```/);
  if (mermaidMatch) {
    const mermaidBody = mermaidMatch[1];
    const edgeRegex =
      /([\w-]+)(?:\["[^"]+"\])?\s*-->\s*([\w-]+)(?:\["[^"]+"\])?/g;
    let match = edgeRegex.exec(mermaidBody);
    while (match !== null) {
      edges.push({
        from_id: match[1],
        to_id: match[2],
        edge_type: "DEPENDS_ON",
      });
      match = edgeRegex.exec(mermaidBody);
    }
  }

  // 2. Parse Features section
  // ### Feature 013 — Agent-Native Interface ✅
  const featureSections = content.split(/^### Feature /m).slice(1);
  for (const section of featureSections) {
    const lines = section.split("\n");
    const headerLine = lines[0]; // e.g. "013 — Agent-Native Interface ✅"

    // Extract ID (e.g. 013 or 000-TDD) and convert to F-prefixed if needed
    const idPartMatch = headerLine.match(/^([A-Z0-9-]+)/);
    if (!idPartMatch) continue;

    let id = idPartMatch[1];
    if (!id.startsWith("F")) {
      id = `F${id}`;
    }

    const name = headerLine
      .replace(/^[A-Z0-9-]+\s*[—–-]\s*/, "")
      .replace(/(?:✅|⚠️|🟡|🔴|⚫).*$/, "")
      .trim();

    let status = "PLANNED";
    if (headerLine.includes("✅")) status = "DONE";
    else if (headerLine.includes("⚠️")) status = "SHIPPED";
    else if (headerLine.includes("🟡")) status = "SPECIFIED";
    else if (headerLine.includes("🔴")) status = "IN_PROGRESS";
    else if (headerLine.includes("⚫")) status = "RETIRED";

    // Status line override
    const statusLine = lines.find((l) => l.match(/^\*\*Status:\*\*/i));
    if (statusLine) {
      const s = statusLine.toLowerCase();
      if (s.includes("complete") || s.includes("done")) status = "DONE";
      else if (s.includes("shipped")) status = "SHIPPED";
      else if (s.includes("in progress")) status = "IN_PROGRESS";
      else if (s.includes("defined")) status = "DEFINED";
      else if (s.includes("specified")) status = "SPECIFIED";
    }

    features.push({ id, name, status, sp_total: 0 });

    // 3. Parse Phases within feature if present
    // 1. **Phase 1 — Foundation (7 SP):** `withSignal()` wrapper...
    const phaseHeaderIndex = lines.findIndex((l) =>
      l.toLowerCase().includes("implementation phases"),
    );
    if (phaseHeaderIndex !== -1) {
      let seq = 1;
      for (let i = phaseHeaderIndex + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === "" || line.startsWith("#")) continue;

        // Match: 1. **Phase 1 — Title (7 SP):** ...
        // or: - Phase 1: Title (7 SP)
        const phaseMatch = line.match(
          /(?:Phase\s+(\d+)|[\d.]+)\s*[—–\-:]\s*(\*\*)?([^(:\n]+)(?:\*\*)?\s*(?:\((\d+)\s*SP\))?/i,
        );
        if (phaseMatch) {
          const phaseName = phaseMatch[3]
            .trim()
            .replace(/\*\*$/, "")
            .replace(/:$/, "")
            .trim();
          const spEstimate = phaseMatch[4]
            ? Number.parseInt(phaseMatch[4], 10)
            : 0;
          const phaseId = `${id}-P${seq}`;
          phases.push({
            id: phaseId,
            feature_id: id,
            name: phaseName,
            status: status === "DONE" ? "DONE" : "PLANNED",
            health: "CLEAN",
            sp_estimate: spEstimate,
            seq: seq++,
          });
        } else if (line.match(/^\d+\./) || line.startsWith("-")) {
          // Might be a simple phase without "Phase" keyword
          const simpleMatch = line.match(
            /(?:\d+\.|-)\s*(\*\*)?([^(:\n]+)(?:\*\*)?\s*(?:\((\d+)\s*SP\))?/,
          );
          if (simpleMatch) {
            const phaseName = simpleMatch[2]
              .trim()
              .replace(/\*\*$/, "")
              .replace(/:$/, "")
              .trim();
            const spEstimate = simpleMatch[3]
              ? Number.parseInt(simpleMatch[3], 10)
              : 0;
            const phaseId = `${id}-P${seq}`;
            phases.push({
              id: phaseId,
              feature_id: id,
              name: phaseName,
              status: status === "DONE" ? "DONE" : "PLANNED",
              health: "CLEAN",
              sp_estimate: spEstimate,
              seq: seq++,
            });
          }
        }
      }
    }
  }

  return { features, phases, edges };
}

/**
 * Parse the structured YAML seed payload
 */
function parseYamlSeed(content: string): ParsedPlan {
  const features: PlanFeaturePayload[] = [];
  const phases: PlanPhasePayload[] = [];
  const edges: PlanEdgePayload[] = [];

  // Split by "---" and parse each block
  const blocks = content.split(/\n---\n/);
  for (const block of blocks) {
    if (block.trim().includes("## Features") || block.includes("### F")) {
      const featureBlocks = block.split(/^### /m).slice(1);
      for (const fBlock of featureBlocks) {
        const yamlMatch = fBlock.match(/```yaml([\s\S]*?)```/);
        if (yamlMatch) {
          try {
            const data = yaml.parse(yamlMatch[1]);
            features.push({
              id: data.id,
              name: data.name,
              status: data.status,
              sp_total: data.sp_estimate || 0,
            });

            if (data.phases) {
              let seq = 1;
              for (const p of data.phases) {
                phases.push({
                  id: p.id || `${data.id}-P${seq}`,
                  feature_id: data.id,
                  name: p.name,
                  status: p.status || "PLANNED",
                  health: p.health || "CLEAN",
                  sp_estimate: p.sp_estimate || 0,
                  seq: seq++,
                });
              }
            }
          } catch (e) {
            console.error("Failed to parse YAML block", e);
          }
        }
      }
    }

    if (
      block.trim().includes("## Dependency Edges") ||
      block.includes("edges:")
    ) {
      const yamlMatch = block.match(/```yaml([\s\S]*?)```/);
      if (yamlMatch) {
        try {
          const data = yaml.parse(yamlMatch[1]);
          const edgeList = Array.isArray(data) ? data : data.edges;
          if (edgeList) {
            for (const e of edgeList) {
              edges.push({
                from_id: e.from,
                to_id: e.to,
                edge_type: e.type || "DEPENDS_ON",
              });
            }
          }
        } catch (e) {
          console.error("Failed to parse Edges YAML block", e);
        }
      }
    }
  }

  // Handle case where it's a single large YAML block instead of split by ---
  if (features.length === 0 && content.includes("```yaml")) {
    const matches = content.matchAll(/```yaml([\s\S]*?)```/g);
    for (const match of matches) {
      try {
        const data = yaml.parse(match[1]);
        if (data && typeof data === "object") {
          if (data.id && data.name) {
            // Single feature block
            features.push({
              id: data.id,
              name: data.name,
              status: data.status,
              sp_total: data.sp_estimate || 0,
            });
            if (data.phases) {
              let seq = 1;
              for (const p of data.phases) {
                phases.push({
                  id: p.id || `${data.id}-P${seq}`,
                  feature_id: data.id,
                  name: p.name,
                  status: p.status || "PLANNED",
                  health: p.health || "CLEAN",
                  sp_estimate: p.sp_estimate || 0,
                  seq: seq++,
                });
              }
            }
          } else if (data.edges) {
            const castedData = data as {
              edges: { from: string; to: string; type?: string }[];
            };
            for (const e of castedData.edges) {
              edges.push({
                from_id: e.from,
                to_id: e.to,
                edge_type: e.type || "DEPENDS_ON",
              });
            }
          }
        }
      } catch (e) {}
    }
  }

  return { features, phases, edges };
}
