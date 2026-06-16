/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { PlanEdge, PlanFeature, PlanPhase } from "../db/plan.js";

export function generatePlanVizHtml(
  features: PlanFeature[],
  phases: PlanPhase[],
  edges: PlanEdge[],
  criticalPathIds: string[] = [],
): string {
  // Build nodes
  const nodes: Array<{
    id: string;
    label: string;
    type: "feature" | "phase";
    status: string;
    color: string;
    radius: number;
    featureId?: string;
    phaseCount?: number;
  }> = [];

  for (const f of features) {
    const featurePhases = phases.filter((p) => p.feature_id === f.id);
    const shipped = featurePhases.filter(
      (p) => p.status === "DONE" || p.status === "SHIPPED",
    ).length;

    let color = "#a0aec0"; // gray (PLANNED)
    if (f.status === "DONE" || f.status === "SHIPPED") color = "#48bb78";
    else if (f.status === "IN_PROGRESS") color = "#ed8936";
    else if (f.status === "SPECIFIED" || f.status === "DEFINED") color = "#4299e1";

    nodes.push({
      id: f.id,
      label: f.name !== f.id ? `${f.id}: ${f.name}` : f.id,
      type: "feature",
      status: `${f.status} (${shipped}/${featurePhases.length} phases)`,
      color,
      radius: 22,
      phaseCount: featurePhases.length,
    });
  }

  for (const p of phases) {
    // Phase color matches parent feature but lighter
    const parent = features.find((f) => f.id === p.feature_id);
    let color = "#cbd5e0";
    if (p.status === "DONE" || p.status === "SHIPPED") color = "#9ae6b4";
    else if (p.status === "IN_PROGRESS") color = "#fbd38d";

    nodes.push({
      id: p.id,
      label: p.name,
      type: "phase",
      status: p.status + (p.health && p.health !== "GREEN" ? ` [${p.health}]` : ""),
      color,
      radius: 7,
      featureId: p.feature_id,
    });
  }

  // Build links
  const links: Array<{
    source: string;
    target: string;
    type: string;
  }> = [];

  for (const e of edges) {
    if (nodes.some((n) => n.id === e.from_id) && nodes.some((n) => n.id === e.to_id)) {
      links.push({ source: e.from_id, target: e.to_id, type: e.edge_type });
    }
  }

  for (const p of phases) {
    if (nodes.some((n) => n.id === p.feature_id)) {
      links.push({ source: p.id, target: p.feature_id, type: "CONTAINS" });
    }
  }

  const graphData = JSON.stringify({ nodes, links });

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>gwrk — Build Plan</title>
    <script src="https://d3js.org/d3.v7.min.js"><\/script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            background: #f7f8fa;
            color: #1a202c;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
        }
        svg { display: block; width: 100vw; height: 100vh; }

        .edge-dep { stroke: #718096; stroke-width: 2; fill: none; }
        .edge-contains { stroke: #e2e8f0; stroke-width: 1; stroke-dasharray: 3,3; fill: none; }
        .node-feature { cursor: grab; }
        .node-feature:active { cursor: grabbing; }
        .node-phase { cursor: pointer; }
        .label-feature {
            font-size: 12px; font-weight: 600; fill: #1a202c;
            pointer-events: none; text-anchor: middle;
            paint-order: stroke; stroke: #f7f8fa; stroke-width: 4px;
        }
        .label-phase {
            font-size: 9px; fill: #718096;
            pointer-events: none; text-anchor: middle;
            paint-order: stroke; stroke: #f7f8fa; stroke-width: 3px;
        }

        #ui {
            position: fixed; top: 0; left: 0; right: 0;
            display: flex; align-items: center; justify-content: space-between;
            padding: 10px 16px;
            background: rgba(247,248,250,0.9); backdrop-filter: blur(8px);
            border-bottom: 1px solid #e2e8f0; z-index: 10;
        }
        #ui h1 { font-size: 15px; font-weight: 700; color: #2d3748; }
        .legend {
            display: flex; gap: 16px; align-items: center; font-size: 12px; color: #4a5568;
        }
        .legend-item { display: flex; align-items: center; gap: 4px; }
        .dot { width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid rgba(0,0,0,0.15); }
        .line-sample { width: 18px; height: 2px; }
        .controls { display: flex; gap: 6px; }
        .btn {
            background: #fff; border: 1px solid #e2e8f0; border-radius: 6px;
            padding: 5px 12px; font-size: 12px; color: #4a5568;
            cursor: pointer; transition: all 0.15s;
        }
        .btn:hover { background: #edf2f7; border-color: #cbd5e0; }
        .btn.active { background: #ebf4ff; border-color: #4299e1; color: #2b6cb0; }

        #tooltip {
            position: fixed; display: none; pointer-events: none;
            background: #fff; border: 1px solid #e2e8f0;
            border-radius: 8px; padding: 8px 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.08);
            font-size: 12px; z-index: 20; max-width: 300px;
        }
        #tooltip .tt-label { font-weight: 600; color: #1a202c; }
        #tooltip .tt-status { color: #718096; margin-top: 2px; }

        #stats {
            position: fixed; bottom: 10px; left: 16px;
            font-size: 11px; color: #a0aec0;
        }
    </style>
</head>
<body>
    <div id="ui">
        <h1>gwrk Build Plan</h1>
        <div class="legend">
            <div class="legend-item"><div class="dot" style="background:#48bb78"></div> Shipped</div>
            <div class="legend-item"><div class="dot" style="background:#ed8936"></div> In Progress</div>
            <div class="legend-item"><div class="dot" style="background:#4299e1"></div> Defined</div>
            <div class="legend-item"><div class="dot" style="background:#a0aec0"></div> Planned</div>
            <span style="color:#e2e8f0">|</span>
            <div class="legend-item"><div class="line-sample" style="background:#718096"></div> Dependency</div>
            <div class="legend-item"><div class="line-sample" style="background:#e2e8f0"></div> Contains</div>
        </div>
        <div class="controls">
            <button class="btn" id="btnPhases" onclick="togglePhases()">Show Phases</button>
            <button class="btn" onclick="fitGraph()">Fit</button>
        </div>
    </div>

    <div id="tooltip">
        <div class="tt-label"></div>
        <div class="tt-status"></div>
    </div>

    <div id="stats"></div>

    <script>
    const data = ${graphData};

    const width = window.innerWidth;
    const height = window.innerHeight;
    let showPhases = false; // Start with phases hidden

    const svg = d3.select("body").append("svg")
        .attr("width", width)
        .attr("height", height);

    // Arrow marker
    svg.append("defs").append("marker")
        .attr("id", "arrow")
        .attr("viewBox", "0 -4 8 8")
        .attr("refX", 26)
        .attr("markerWidth", 7)
        .attr("markerHeight", 7)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-4L8,0L0,4Z")
        .attr("fill", "#718096");

    const g = svg.append("g");

    // Zoom
    const zoom = d3.zoom()
        .scaleExtent([0.15, 3])
        .on("zoom", (e) => g.attr("transform", e.transform));
    svg.call(zoom);

    // Simulation — features only initially
    const featureNodes = data.nodes.filter(d => d.type === "feature");
    const phaseNodes = data.nodes.filter(d => d.type === "phase");
    const depLinks = data.links.filter(d => d.type !== "CONTAINS");
    const containLinks = data.links.filter(d => d.type === "CONTAINS");

    // Map link sources/targets to node objects
    const nodeMap = new Map(data.nodes.map(n => [n.id, n]));

    // Resolve links to use node objects
    const resolvedDepLinks = depLinks.map(l => ({
        ...l,
        source: nodeMap.get(typeof l.source === 'string' ? l.source : l.source.id),
        target: nodeMap.get(typeof l.target === 'string' ? l.target : l.target.id),
    })).filter(l => l.source && l.target);

    const resolvedContainLinks = containLinks.map(l => ({
        ...l,
        source: nodeMap.get(typeof l.source === 'string' ? l.source : l.source.id),
        target: nodeMap.get(typeof l.target === 'string' ? l.target : l.target.id),
    })).filter(l => l.source && l.target);

    const simulation = d3.forceSimulation(featureNodes)
        .force("link", d3.forceLink(resolvedDepLinks).id(d => d.id).distance(180).strength(0.4))
        .force("charge", d3.forceManyBody().strength(-800))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide().radius(50))
        .force("x", d3.forceX(width / 2).strength(0.04))
        .force("y", d3.forceY(height / 2).strength(0.04));

    // Draw layers (back to front)
    const containLayer = g.append("g").attr("class", "contain-layer").style("display", "none");
    const depLayer = g.append("g").attr("class", "dep-layer");
    const phaseLayer = g.append("g").attr("class", "phase-layer").style("display", "none");
    const featureLayer = g.append("g").attr("class", "feature-layer");
    const labelLayer = g.append("g").attr("class", "label-layer");
    const phaseLabelLayer = g.append("g").attr("class", "phase-label-layer").style("display", "none");

    // Dependency edges (all feature↔feature after DB normalization)
    const depEdges = depLayer.selectAll("line")
        .data(resolvedDepLinks)
        .join("line")
        .attr("class", "edge-dep")
        .attr("marker-end", "url(#arrow)");

    // Contain edges
    const containEdges = containLayer.selectAll("line")
        .data(resolvedContainLinks)
        .join("line")
        .attr("class", "edge-contains");

    // Feature nodes
    const featureCircles = featureLayer.selectAll("circle")
        .data(featureNodes)
        .join("circle")
        .attr("class", "node-feature")
        .attr("r", d => d.radius)
        .attr("fill", d => d.color)
        .attr("stroke", "#fff")
        .attr("stroke-width", 2.5)
        .call(d3.drag()
            .on("start", dragStart)
            .on("drag", dragging)
            .on("end", dragEnd));

    // Feature labels
    const featureLabels = labelLayer.selectAll("text")
        .data(featureNodes)
        .join("text")
        .attr("class", "label-feature")
        .attr("dy", d => d.radius + 16)
        .text(d => d.label);

    // Phase nodes
    const phaseCircles = phaseLayer.selectAll("circle")
        .data(phaseNodes)
        .join("circle")
        .attr("class", "node-phase")
        .attr("r", d => d.radius)
        .attr("fill", d => d.color)
        .attr("stroke", "#fff")
        .attr("stroke-width", 1);

    // Phase labels
    const phaseLabels = phaseLabelLayer.selectAll("text")
        .data(phaseNodes)
        .join("text")
        .attr("class", "label-phase")
        .attr("dy", d => d.radius + 10)
        .text(d => d.label.length > 30 ? d.label.slice(0, 28) + "…" : d.label);

    // Tooltip
    const tooltip = d3.select("#tooltip");
    featureCircles.on("mouseover", showTip).on("mousemove", moveTip).on("mouseout", hideTip);
    phaseCircles.on("mouseover", showTip).on("mousemove", moveTip).on("mouseout", hideTip);

    function showTip(e, d) {
        tooltip.style("display", "block")
            .style("left", (e.pageX + 14) + "px")
            .style("top", (e.pageY - 8) + "px");
        tooltip.select(".tt-label").text(d.label);
        tooltip.select(".tt-status").text(d.status);
    }
    function moveTip(e) {
        tooltip.style("left", (e.pageX + 14) + "px").style("top", (e.pageY - 8) + "px");
    }
    function hideTip() { tooltip.style("display", "none"); }

    // Position phases around their parent features
    function positionPhases() {
        phaseNodes.forEach(p => {
            const parent = nodeMap.get(p.featureId);
            if (parent) {
                const siblings = phaseNodes.filter(s => s.featureId === p.featureId);
                const idx = siblings.indexOf(p);
                const angle = (idx / siblings.length) * Math.PI * 2 - Math.PI / 2;
                const dist = 45 + siblings.length * 4;
                p.x = parent.x + Math.cos(angle) * dist;
                p.y = parent.y + Math.sin(angle) * dist;
            }
        });
    }

    // Tick
    simulation.on("tick", () => {
        depEdges.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x).attr("y2", d => d.target.y);

        featureCircles.attr("cx", d => d.x).attr("cy", d => d.y);
        featureLabels.attr("x", d => d.x).attr("y", d => d.y);

        if (showPhases) {
            positionPhases();
            phaseCircles.attr("cx", d => d.x).attr("cy", d => d.y);
            phaseLabels.attr("x", d => d.x).attr("y", d => d.y);
            containEdges.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
                .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
        }
    });

    // Drag
    function dragStart(e, d) { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; }
    function dragging(e, d) { d.fx = e.x; d.fy = e.y; }
    function dragEnd(e, d) { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }

    // Toggle phases
    function togglePhases() {
        showPhases = !showPhases;
        const btn = document.getElementById("btnPhases");
        btn.textContent = showPhases ? "Hide Phases" : "Show Phases";
        btn.classList.toggle("active", showPhases);

        phaseLayer.style("display", showPhases ? null : "none");
        phaseLabelLayer.style("display", showPhases ? null : "none");
        containLayer.style("display", showPhases ? null : "none");

        if (showPhases) {
            positionPhases();
            phaseCircles.attr("cx", d => d.x).attr("cy", d => d.y);
            phaseLabels.attr("x", d => d.x).attr("y", d => d.y);
            containEdges.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
                .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
        }
    }

    // Fit graph to viewport
    function fitGraph() {
        const bounds = g.node().getBBox();
        if (bounds.width === 0) return;
        const pad = 60;
        const fullW = bounds.width + pad * 2;
        const fullH = bounds.height + pad * 2;
        const scale = Math.min(width / fullW, height / fullH, 1.2);
        const tx = width / 2 - (bounds.x + bounds.width / 2) * scale;
        const ty = height / 2 - (bounds.y + bounds.height / 2) * scale;
        svg.transition().duration(600)
            .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
    }

    // Auto-fit after layout settles
    simulation.on("end", fitGraph);

    // Stats
    const fc = featureNodes.length, pc = phaseNodes.length, dc = depLinks.length;
    d3.select("#stats").text(fc + " features · " + pc + " phases · " + dc + " deps");
    </script>
</body>
</html>`;
}
