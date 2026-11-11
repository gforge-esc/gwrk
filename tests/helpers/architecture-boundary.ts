/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import path from "node:path";
import ts from "typescript";

type DependencyKind = "static" | "dynamic" | "require";

const inwardLayers: Record<string, readonly string[]> = {
  domain: ["domain"],
  ports: ["domain", "ports"],
  application: ["domain", "ports", "application"],
  db: ["db", "domain", "ports"],
};

const purePackages = new Set([
  "zod",
  "node:crypto",
  "crypto",
  "node:path",
  "path",
  "node:path/posix",
  "path/posix",
]);

export function inspectArchitectureSource(file: string, source: string) {
  const imports: Array<{ kind: DependencyKind; specifier: string | null }> = [];
  const effects: string[] = [];
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);

  function dependency(kind: DependencyKind, expression?: ts.Node) {
    imports.push({
      kind,
      specifier:
        expression && ts.isStringLiteralLike(expression)
          ? expression.text
          : null,
    });
  }

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) dependency("static", node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node)) {
      if (ts.isExternalModuleReference(node.moduleReference)) {
        dependency("require", node.moduleReference.expression);
      }
    } else if (ts.isImportTypeNode(node)) {
      if (ts.isLiteralTypeNode(node.argument)) {
        dependency("static", node.argument.literal);
      }
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        dependency("dynamic", node.arguments[0]);
      } else if (ts.isIdentifier(callee) && callee.text === "require") {
        dependency("require", node.arguments[0]);
      } else if (ts.isIdentifier(callee) && callee.text === "createRequire") {
        imports.push({ kind: "require", specifier: callee.text });
      } else if (ts.isIdentifier(callee) && callee.text === "Date") {
        effects.push("ambient:Date()");
      }
    } else if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Date" &&
      !node.arguments?.length
    ) {
      effects.push("ambient:new Date()");
    } else if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      const base = node.expression;
      const member = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : ts.isStringLiteralLike(node.argumentExpression)
          ? node.argumentExpression.text
          : null;
      if (ts.isIdentifier(base) && base.text === "process") {
        effects.push(`ambient:process.${member ?? "<computed>"}`);
      } else if (
        ts.isIdentifier(base) &&
        base.text === "Date" &&
        member === "now"
      ) {
        effects.push("ambient:Date.now");
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(ast);
  return { imports, effects };
}

export function architectureViolations(file: string, source: string): string[] {
  const layer = file.split("/")[0];
  const restricted =
    layer === "domain" || layer === "ports" || layer === "application";
  const { imports, effects } = inspectArchitectureSource(file, source);
  const violations = layer === "domain" ? [...effects] : [];

  for (const { kind, specifier } of imports) {
    if (restricted && specifier === null) {
      violations.push(`${kind}:<non-literal>`);
      continue;
    }
    if (specifier === null) continue;
    if (restricted && kind === "require") {
      violations.push(`require:${specifier}`);
      continue;
    }
    if (layer === "domain" && kind === "dynamic") {
      violations.push(`dynamic:${specifier}`);
      continue;
    }
    if (!specifier.startsWith(".")) {
      if (restricted && !purePackages.has(specifier)) {
        violations.push(`package:${specifier}`);
      }
      continue;
    }

    const target = path.posix.normalize(
      path.posix.join(path.posix.dirname(file), specifier),
    );
    const targetLayer = target.split("/")[0];
    if (
      (inwardLayers[layer] && !inwardLayers[layer].includes(targetLayer)) ||
      ((layer === "utils" || layer === "engine") && targetLayer === "server")
    ) {
      const rule = kind === "dynamic" ? "dynamic-dependency" : "dependency";
      violations.push(`${rule}:${target}`);
    }
  }
  return violations.map((violation) => `${file} -> ${violation}`);
}
