import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PROJECT_ROOT = process.cwd();
const SPECS_DIR = path.join(PROJECT_ROOT, "specs");

interface GapMatrixRow {
  ac: string;
}

interface TestFailure {
  testFile: string;
  ancestorTitles: string[];
  title: string;
  failureMessages: string[];
}

function buildAcToFeatureMap(): Record<string, string> {
  const map: Record<string, string> = {};
  if (!fs.existsSync(SPECS_DIR)) return map;

  const features = fs.readdirSync(SPECS_DIR).filter((f) => {
    return (
      fs.statSync(path.join(SPECS_DIR, f)).isDirectory() && /^\d{3}-/.test(f)
    );
  });

  for (const feature of features) {
    const gapMatrixPath = path.join(SPECS_DIR, feature, "gap-matrix.md");
    if (!fs.existsSync(gapMatrixPath)) continue;

    const content = fs.readFileSync(gapMatrixPath, "utf-8");
    const lines = content.split("\n");

    for (const line of lines) {
      if (
        line.trim().startsWith("|") &&
        !line.includes("| AC |") &&
        !line.includes("|----|")
      ) {
        const cells = line.split("|").map((c) => c.trim());
        if (cells.length > 2) {
          const ac = cells[1];
          if (ac && ac.match(/^(?:FR|US|TR)-[A-Z0-9]+/i)) {
            map[ac] = feature;
          }
        }
      }
    }
  }
  return map;
}

function runVitest(): {
  successes: number;
  failures: TestFailure[];
  total: number;
} {
  console.log("Running pnpm vitest run --reporter json...");
  const tmpFile = path.join(os.tmpdir(), `vitest-report-${Date.now()}.json`);

  try {
    execSync(`pnpm vitest run --reporter json --outputFile ${tmpFile}`, {
      encoding: "utf-8",
      maxBuffer: 1024 * 1024 * 10,
      stdio: "ignore",
    });
  } catch (error: any) {
    // vitest exits with 1 when tests fail, which is expected
  }

  if (!fs.existsSync(tmpFile)) {
    console.error("Failed to generate Vitest report.");
    process.exit(1);
  }

  let parsed: any;
  try {
    const jsonStr = fs.readFileSync(tmpFile, "utf-8");
    parsed = JSON.parse(jsonStr);
    fs.unlinkSync(tmpFile); // clean up
  } catch (e) {
    console.error("Failed to parse Vitest JSON output.");
    process.exit(1);
  }

  const failures: TestFailure[] = [];
  let successes = 0;
  let total = 0;

  for (const result of parsed.testResults || []) {
    const testFile = path.relative(PROJECT_ROOT, result.name);
    for (const assertion of result.assertionResults || []) {
      total++;
      if (assertion.status === "failed") {
        failures.push({
          testFile,
          ancestorTitles: assertion.ancestorTitles || [],
          title: assertion.title || "",
          failureMessages: assertion.failureMessages || [],
        });
      } else if (assertion.status === "passed") {
        successes++;
      }
    }
  }

  return { successes, failures, total };
}

function extractAc(text: string): string | null {
  const match = text.match(/(?:FR|US|TR)-[A-Z0-9]+/i);
  return match ? match[0].toUpperCase() : null;
}

function main() {
  const acMap = buildAcToFeatureMap();
  const { successes, failures, total } = runVitest();

  if (failures.length === 0) {
    console.log(`\n✅ All ${total} tests passed!`);
    return;
  }

  // Group failures by Feature
  const grouped: Record<string, TestFailure[]> = {};

  for (const failure of failures) {
    // Try to extract AC from ancestorTitles, then title
    let foundFeature = "Unknown Feature (Unmapped)";

    // Look through ancestor titles first (describe blocks)
    for (const title of failure.ancestorTitles) {
      const ac = extractAc(title);
      if (ac && acMap[ac]) {
        foundFeature = acMap[ac];
        break;
      }
    }

    // If not found, try the test title itself
    if (foundFeature === "Unknown Feature (Unmapped)") {
      const ac = extractAc(failure.title);
      if (ac && acMap[ac]) {
        foundFeature = acMap[ac];
      }
    }

    if (!grouped[foundFeature]) {
      grouped[foundFeature] = [];
    }
    grouped[foundFeature].push(failure);
  }

  console.log("\n==================================================");
  console.log(
    `❌ TEST FAILURES BY FEATURE (${failures.length} failed / ${total} total)`,
  );
  console.log("==================================================\n");

  const sortedFeatures = Object.keys(grouped).sort((a, b) => {
    if (a === "Unknown Feature (Unmapped)") return 1;
    if (b === "Unknown Feature (Unmapped)") return -1;
    return a.localeCompare(b);
  });

  for (const feature of sortedFeatures) {
    const featureFailures = grouped[feature];
    console.log(`──────────────────────────────────────────────────`);
    console.log(`🔴 ${feature} (${featureFailures.length} failing tests)`);
    console.log(`──────────────────────────────────────────────────`);

    // Group by test file within the feature
    const byFile: Record<string, TestFailure[]> = {};
    for (const f of featureFailures) {
      if (!byFile[f.testFile]) byFile[f.testFile] = [];
      byFile[f.testFile].push(f);
    }

    for (const [file, fileFailures] of Object.entries(byFile)) {
      console.log(`  📂 ${file}`);
      for (const f of fileFailures) {
        const fullPath = [...f.ancestorTitles, f.title].join(" > ");
        console.log(`    ❌ ${fullPath}`);
      }
      console.log("");
    }
  }
}

main();
