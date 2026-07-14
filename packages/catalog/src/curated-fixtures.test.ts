import { describe, expect, it } from 'vitest';

import invalidDuplicateProduct from './fixtures/invalid-curated-duplicate-product.json' with { type: 'json' };
import invalidLaneLayer from './fixtures/invalid-curated-lane-layer.json' with { type: 'json' };
import invalidMeter from './fixtures/invalid-curated-meter.json' with { type: 'json' };
import invalidSourceHost from './fixtures/invalid-curated-source-host.json' with { type: 'json' };
import invalidUnknownReference from './fixtures/invalid-curated-unknown-reference.json' with { type: 'json' };
import validCuratedMinimal from './fixtures/valid-curated-minimal.json' with { type: 'json' };
import validMinimalCatalog from './fixtures/valid-minimal.json' with { type: 'json' };
import {
  collectCuratedReferenceIssues,
  parseCatalog,
  safeParseCuratedData,
  type CatalogIssueCode,
} from './index.js';

const invalidCases = [
  {
    name: 'invalid-curated-lane-layer',
    fixture: invalidLaneLayer,
    code: 'invalid-shape',
    path: 'products[0].placements[0].layer',
  },
  {
    name: 'invalid-curated-duplicate-product',
    fixture: invalidDuplicateProduct,
    code: 'duplicate-id',
    path: 'products[1].productId',
  },
  {
    name: 'invalid-curated-source-host',
    fixture: invalidSourceHost,
    code: 'invalid-shape',
    path: 'products[0].sourceUrl',
  },
  {
    name: 'invalid-curated-meter',
    fixture: invalidMeter,
    code: 'invalid-shape',
    path: 'pricing[0].tiers[0].meters[0].overage.perUnits',
  },
] satisfies readonly { name: string; fixture: unknown; code: CatalogIssueCode; path: string }[];

describe('curated fixtures', () => {
  it('valid-curated-minimal passes shape validation and resolves against valid-minimal', () => {
    const result = safeParseCuratedData(validCuratedMinimal);
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    const catalog = parseCatalog(validMinimalCatalog);
    expect(collectCuratedReferenceIssues(result.data, catalog)).toEqual([]);
  });

  it.each(invalidCases)('$name is rejected at $path', ({ fixture, code, path }) => {
    const result = safeParseCuratedData(fixture);
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.issues.map((issue) => issue.code)).toContain(code);
    expect(result.issues.map((issue) => issue.path)).toContain(path);
  });

  it('invalid-curated-unknown-reference is shape-valid but fails catalog cross-references', () => {
    const result = safeParseCuratedData(invalidUnknownReference);
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    const catalog = parseCatalog(validMinimalCatalog);
    const issues = collectCuratedReferenceIssues(result.data, catalog);
    expect(issues.map((issue) => issue.path)).toEqual([
      'products[0].productId',
      'compositions[0].solutionId',
      'compositions[0].productIds[1]',
      'pricing[0].productId',
    ]);
    expect(issues.every((issue) => issue.code === 'unknown-entity-reference')).toBe(true);
  });
});
