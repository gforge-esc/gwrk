import fs from "node:fs/promises";
import path from "node:path";

/**
 * FR-R006-001: Scaffold logic for R0XX numbering and brief generation.
 */

export interface ScaffoldOptions {
  methodology?: string;
}

export interface ScaffoldResult {
  directory: string;
}

export class ResearchScaffolder {
  /**
   * US-017: Scaffolds a new research directory and brief.md
   */
  async scaffold(initiative: string, options: ScaffoldOptions = {}): Promise<ScaffoldResult> {
    if (!initiative) {
      throw new Error("Initiative name is required");
    }

    const researchDir = path.join(process.cwd(), "docs", "research");
    
    // Ensure docs/research exists
    await fs.mkdir(researchDir, { recursive: true });

    // 1. Determine next R0XX number
    const existing = await fs.readdir(researchDir);
    const researchDirs = existing.filter(d => d.startsWith("R") && /R\d{3}-/.test(d));
    
    let nextNum = 1;
    if (researchDirs.length > 0) {
      const numbers = researchDirs.map(d => {
        const match = d.match(/^R(\d{3})-/);
        return match ? parseInt(match[1], 10) : 0;
      });
      nextNum = Math.max(...numbers) + 1;
    }
    
    const prefix = `R${nextNum.toString().padStart(3, "0")}`;
    
    // 2. Slugify initiative
    const slug = initiative
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    
    const targetDirName = `${prefix}-${slug}`;
    const targetPath = path.join(researchDir, targetDirName);
    
    // 3. Create directory
    await fs.mkdir(targetPath, { recursive: true });
    
    // 4. Create brief.md
    const methodology = options.methodology || "technical";
    const briefContent = `---
initiative: ${initiative}
prefix: ${prefix}
methodology: ${methodology}
status: open
created: ${new Date().toISOString().split("T")[0]}
---

# ${prefix}: ${initiative}

## Objective
<!-- What are we trying to learn or prove? -->

## Methodology: ${methodology}
<!-- Details of the research approach -->

## Discovery
<!-- Key findings and observations -->

## Conclusion
<!-- Recommendations and next steps -->
`;

    await fs.writeFile(path.join(targetPath, "brief.md"), briefContent);

    return {
      directory: path.join("docs", "research", targetDirName)
    };
  }
}
