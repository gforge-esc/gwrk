import pkg from "graphology";
const { MultiGraph } = pkg;
import forceAtlas2 from "graphology-layout-forceatlas2";
import type { PlanEdge, PlanFeature, PlanPhase } from "../db/plan.js";

export function generatePlanVizHtml(
  features: PlanFeature[],
  phases: PlanPhase[],
  edges: PlanEdge[],
  criticalPathIds: string[] = [],
): string {
  const graph = new MultiGraph();

  // Add nodes for features
  for (const f of features) {
    let color = "#cccccc"; // Default (PLANNED)
    if (f.status === "DONE" || f.status === "SHIPPED") {
      color = "#28a745"; // Green
    } else if (f.status === "IN_PROGRESS") {
      color = "#ffc107"; // Yellow
    } else if (f.status === "SPECIFIED" || f.status === "DEFINED") {
      color = "#17a2b8"; // Cyan
    }

    graph.addNode(f.id, {
      label: f.name,
      size: 15,
      color,
      status: f.status,
      type: "feature",
    });
  }

  // Add nodes for phases
  for (const p of phases) {
    let color = "#eeeeee";
    if (p.status === "DONE" || p.status === "SHIPPED") {
      color = "#2ecc71";
    } else if (p.status === "IN_PROGRESS") {
      color = "#f1c40f";
    }

    // Highlight critical path
    const isCritical = criticalPathIds.includes(p.id);
    const borderColor = isCritical ? "#e74c3c" : undefined;

    graph.addNode(p.id, {
      label: p.name,
      size: 10,
      color,
      status: p.status,
      type: "phase",
      feature_id: p.feature_id,
      borderColor,
    });

    // Implicit edge from phase to its feature
    if (graph.hasNode(p.feature_id)) {
      graph.addEdge(p.id, p.feature_id, {
        type: "CONTAINS",
        color: "#dddddd",
      });
    }
  }

  // Add edges from plan_edges
  for (const e of edges) {
    if (graph.hasNode(e.from_id) && graph.hasNode(e.to_id)) {
      const isCritical =
        criticalPathIds.includes(e.from_id) &&
        criticalPathIds.includes(e.to_id);
      graph.addEdge(e.from_id, e.to_id, {
        label: e.edge_type,
        size: isCritical ? 3 : 1,
        color: isCritical ? "#e74c3c" : "#999999",
        type: e.edge_type,
      });
    }
  }

  // Pre-calculate layout
  // graphology-layout-forceatlas2 CJS/ESM interop: the default export
  // is an IForceAtlas2Layout with .assign and .inferSettings, but TS
  // sees the import shape differently. We use a typed interface.
  interface FA2Layout {
    assign: (
      graph: InstanceType<typeof MultiGraph>,
      params: { iterations: number; settings: Record<string, unknown> },
    ) => void;
    inferSettings: (
      graph: InstanceType<typeof MultiGraph>,
    ) => Record<string, unknown>;
  }
  const fa2 = forceAtlas2 as unknown as FA2Layout;
  fa2.assign(graph, {
    iterations: 100,
    settings: fa2.inferSettings(graph),
  });

  const graphData = graph.export();

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>gwrk Build Plan Visualization</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/sigma.js/2.4.0/sigma.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/graphology/0.25.1/graphology.umd.min.js"></script>
    <style>
        body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #f8f9fa; font-family: sans-serif; }
        #container { width: 100%; height: 100%; }
        #legend { position: absolute; top: 20px; left: 20px; background: white; padding: 15px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .legend-item { display: flex; align-items: center; margin-bottom: 5px; font-size: 14px; }
        .color-box { width: 15px; height: 15px; margin-right: 10px; border-radius: 3px; }
        #info { position: absolute; bottom: 20px; right: 20px; background: white; padding: 15px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 300px; display: none; }
    </style>
</head>
<body>
    <div id="container"></div>
    <div id="legend">
        <strong>Status Legend</strong>
        <div class="legend-item"><div class="color-box" style="background: #28a745;"></div> DONE / SHIPPED</div>
        <div class="legend-item"><div class="color-box" style="background: #ffc107;"></div> IN_PROGRESS</div>
        <div class="legend-item"><div class="color-box" style="background: #17a2b8;"></div> SPECIFIED / DEFINED</div>
        <div class="legend-item"><div class="color-box" style="background: #cccccc;"></div> PLANNED</div>
        <div class="legend-item"><div class="color-box" style="background: #e74c3c; border: 2px solid #e74c3c; width: 11px; height: 11px;"></div> Critical Path</div>
    </div>
    <div id="info"></div>

    <script>
        const data = ${JSON.stringify(graphData)};
        const graph = new graphology.Graph();
        graph.import(data);

        const container = document.getElementById('container');
        const renderer = new Sigma(graph, container, {
            renderEdgeLabels: true,
            labelSize: 12,
            labelGridCellSize: 60,
        });

        const info = document.getElementById('info');
        renderer.on('enterNode', ({ node }) => {
            const attrs = graph.getNodeAttributes(node);
            info.innerHTML = \`<strong>\${attrs.label}</strong><br>Type: \${attrs.type}<br>Status: \${attrs.status}\`;
            info.style.display = 'block';
        });
        renderer.on('leaveNode', () => {
            info.style.display = 'none';
        });
    </script>
</body>
</html>
  `;
}
