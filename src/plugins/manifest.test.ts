/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import { SkillManifestSchema, AnyManifestSchema } from './manifest.js';

describe('FR-013 / US-016: SkillManifestSchema Enforcement Tier', () => {
  it('TR-P9-003: accepts tier: enforcement and scope: implementation', () => {
    const manifest = {
      name: 'typescript-standards',
      type: 'skill',
      tier: 'enforcement',
      scope: 'implementation',
      version: '1.0.0',
      description: 'Strict TypeScript enforcement'
    };
    
    const result = SkillManifestSchema.parse(manifest);
    expect(result.tier).toBe('enforcement');
    expect(result.scope).toBe('implementation');
  });

  it('rejects invalid scope for enforcement skills', () => {
    const manifest = {
      name: 'bad-skill',
      type: 'skill',
      tier: 'enforcement',
      scope: 'invalid-scope',
      version: '1.0.0'
    };
    
    expect(() => SkillManifestSchema.parse(manifest)).toThrow();
  });
});

describe("ExtensionManifestSchema (Phase 19)", () => {
  it("FR-L3-001: validates a valid extension manifest", () => {
    const manifest = {
      name: "obsidian-vault",
      type: "extension",
      version: "1.0.0",
      description: "Obsidian integration",
      provides: ["context"],
      adapter: "./adapter.js",
    };

    const result = AnyManifestSchema.parse(manifest);
    expect(result.type).toBe("extension");
    expect((result as any).provides).toContain("context");
  });

  it("rejects invalid provides values", () => {
    const manifest = {
      name: "bad-ext",
      type: "extension",
      version: "1.0.0",
      description: "Bad extension",
      provides: ["invalid-capability"],
      adapter: "./adapter.js",
    };

    expect(() => AnyManifestSchema.parse(manifest)).toThrow();
  });
});
