import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import { parsePlan } from "./parser-plan.js";

vi.mock("node:fs");

describe("src/utils/parser-plan.ts", () => {
  it("FR-013: should parse Mermaid edges correctly", () => {
    const markdown = `
# Plan
\`\`\`mermaid
graph TD
    F000["F000: Extraction ✅"] --> F001["F001: CLI Core ✅"]
    F001 --> F013["F013: Agent-Native Interface ✅"]
\`\`\`
`;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(markdown);

    const result = parsePlan("dummy.md");
    expect(result.edges).toHaveLength(2);
    expect(result.edges[0]).toEqual({ from_id: "F000", to_id: "F001", edge_type: "DEPENDS_ON" });
    expect(result.edges[1]).toEqual({ from_id: "F001", to_id: "F013", edge_type: "DEPENDS_ON" });
  });

  it("FR-013: should parse features and phases correctly", () => {
    const markdown = `
### Feature 001 — CLI Core ✅

Bootstrap the gwrk CLI.

#### Implementation phases:
1. **Phase 1 — Foundation (7 SP):** CLI entry...
2. **Phase 2 — Discovery (10 SP):** discovery...

### Feature 002 — Build Server 🔴

#### Implementation phases:
- Phase 1: Fastify daemon (5 SP)
- Phase 2: Dispatch queue (8 SP)
`;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(markdown);

    const result = parsePlan("dummy.md");
    expect(result.features).toHaveLength(2);
    expect(result.features[0].id).toBe("F001");
    expect(result.features[0].status).toBe("DONE");
    
    expect(result.phases).toHaveLength(4);
    expect(result.phases[0]).toEqual(expect.objectContaining({
      id: "F001-P1",
      name: "Foundation",
      sp_estimate: 7,
      status: "DONE"
    }));
    expect(result.phases[2]).toEqual(expect.objectContaining({
      id: "F002-P1",
      name: "Fastify daemon",
      sp_estimate: 5,
      status: "PLANNED"
    }));
  });

  it("FR-013: should parse YAML seed payloads", () => {
    const yamlContent = `
---
## Features
### F018
\`\`\`yaml
id: F018
name: Build Plan Orchestrator
status: PLANNED
phases:
  - name: Data Model
    sp_estimate: 5
\`\`\`

---
## Dependency Edges
\`\`\`yaml
edges:
  - from: F014
    to: F018
\`\`\`
`;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(yamlContent);

    const result = parsePlan("seed-payload.md");
    expect(result.features).toHaveLength(1);
    expect(result.features[0].id).toBe("F018");
    expect(result.phases).toHaveLength(1);
    expect(result.phases[0].name).toBe("Data Model");
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].from_id).toBe("F014");
  });
});
