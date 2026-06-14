import fs from "node:fs/promises";
import path from "node:path";

export interface SourceMaterial {
  specs: string[];
  architecture: string;
  patterns: string[];
}

/**
 * FR-L25-011: Scan specs and codebase for grounding material
 */
export async function scan(projectRoot: string): Promise<SourceMaterial> {
  const material: SourceMaterial = {
    specs: [],
    architecture: "",
    patterns: [],
  };

  // 1. Scan specs/ directory
  const specsDir = path.join(projectRoot, "specs");
  try {
    const featureDirs = await fs.readdir(specsDir);
    for (const feature of featureDirs) {
      const specPath = path.join(specsDir, feature, "spec.md");
      try {
        const content = await fs.readFile(specPath, "utf-8");
        material.specs.push(content);
      } catch {
        // Skip missing spec.md
      }
    }
  } catch {
    // No specs dir
  }

  // 2. Scan for architecture grounding
  const archPaths = [
    path.join(projectRoot, "docs", "architecture.md"),
    path.join(projectRoot, "ARCHITECTURE.md"),
    path.join(projectRoot, "README.md"),
  ];

  for (const archPath of archPaths) {
    try {
      material.architecture = await fs.readFile(archPath, "utf-8");
      break;
    } catch {
      // Try next path
    }
  }

  // 3. Scan for patterns (e.g. from ADRs or specific docs)
  const decisionsDir = path.join(projectRoot, "docs", "decisions");
  try {
    const adrs = await fs.readdir(decisionsDir);
    for (const adr of adrs) {
      if (adr.endsWith(".md")) {
        const content = await fs.readFile(path.join(decisionsDir, adr), "utf-8");
        material.patterns.push(content);
      }
    }
  } catch {
    // No decisions dir
  }

  return material;
}
