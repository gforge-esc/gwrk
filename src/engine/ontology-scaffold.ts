/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs/promises";
import path from "node:path";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * FR-L25-009: Logic for directory and empty artifact creation
 */
export async function scaffold(projectRoot: string): Promise<void> {
  const ontologyDir = path.join(projectRoot, ".gwrk", "ontology");
  const perspectiveDir = path.join(projectRoot, ".gwrk", "perspective");

  await fs.mkdir(ontologyDir, { recursive: true });
  await fs.mkdir(perspectiveDir, { recursive: true });

  const domainPath = path.join(ontologyDir, "domain.md");
  if (!(await fileExists(domainPath))) {
    await fs.writeFile(
      domainPath,
      "# Domain Ontology\n\n## Classes\n\n## Properties\n\n## Relations\n\n## Axioms\n\n## Individuals\n",
    );
  }

  const hierarchyPath = path.join(perspectiveDir, "hierarchy.md");
  if (!(await fileExists(hierarchyPath))) {
    await fs.writeFile(
      hierarchyPath,
      "# Information Hierarchy\n\n## Pillars\n\n## Entities\n",
    );
  }

  const uxPath = path.join(perspectiveDir, "ux-posture.md");
  if (!(await fileExists(uxPath))) {
    await fs.writeFile(
      uxPath,
      "# UX Posture\n\n## Principles\n\n## Voice & Tone\n",
    );
  }
}
