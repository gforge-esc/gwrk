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
   * Slugify an initiative name for directory naming.
   */
  private slugify(initiative: string): string {
    const stripped = initiative.replace(/^R\d{3}-/i, "");
    return stripped
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  /**
   * US-017: Scaffolds a new research directory and brief.md.
   * Idempotent: if a directory matching the initiative slug already exists,
   * returns that directory instead of creating a new one.
   */
  async scaffold(initiative: string, options: ScaffoldOptions = {}): Promise<ScaffoldResult> {
    if (!initiative) {
      throw new Error("Initiative name is required");
    }

    const researchDir = path.join(process.cwd(), "docs", "research");
    
    // Ensure docs/research exists
    await fs.mkdir(researchDir, { recursive: true });

    // 1. Read existing directories
    const existing = await fs.readdir(researchDir);
    const researchDirs = existing.filter(d => d.startsWith("R") && /R\d{3}-/.test(d));

    // 2. Check for existing directory matching this initiative (idempotency)
    const slug = this.slugify(initiative);
    const existingMatch = researchDirs.find(d => {
      // Extract slug portion after R0XX-
      const dirSlug = d.replace(/^R\d{3}-/, "");
      return dirSlug === slug;
    });

    if (existingMatch) {
      return {
        directory: path.join("docs", "research", existingMatch),
      };
    }
    
    // 3. Determine next R0XX number
    let nextNum = 1;
    if (researchDirs.length > 0) {
      const numbers = researchDirs.map(d => {
        const match = d.match(/^R(\d{3})-/);
        return match ? parseInt(match[1], 10) : 0;
      });
      nextNum = Math.max(...numbers) + 1;
    }
    
    const prefix = `R${nextNum.toString().padStart(3, "0")}`;
    
    const targetDirName = `${prefix}-${slug}`;
    const targetPath = path.join(researchDir, targetDirName);
    
    // 4. Create directory
    await fs.mkdir(targetPath, { recursive: true });
    
    // 5. Create brief.md
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

  /**
   * US-018: Resolve an existing research directory by R0XX prefix.
   * Used by `gwrk define research R011 --run` to find and run against
   * an existing research initiative without re-scaffolding.
   */
  async resolveByPrefix(prefix: string): Promise<ScaffoldResult> {
    const researchDir = path.join(process.cwd(), "docs", "research");
    const existing = await fs.readdir(researchDir);

    const normalizedPrefix = prefix.toUpperCase();
    const match = existing.find(d => d.toUpperCase().startsWith(`${normalizedPrefix}-`));

    if (!match) {
      throw new Error(`Research initiative ${prefix} not found in docs/research/`);
    }

    return {
      directory: path.join("docs", "research", match),
    };
  }
}

