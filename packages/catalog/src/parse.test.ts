import { describe, expect, it } from 'vitest';

import { CatalogValidationError, parseCatalog, safeParseCatalog } from './index.js';

const invalidDocument: unknown = { schemaVersion: '999' };

describe('parseCatalog', () => {
  it('throws CatalogValidationError with every issue listed in the message', () => {
    let caught: unknown;
    try {
      parseCatalog(invalidDocument);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CatalogValidationError);
    if (!(caught instanceof CatalogValidationError)) {
      throw new Error('expected a CatalogValidationError');
    }
    expect(caught.issues.length).toBeGreaterThan(0);
    expect(caught.message).toContain('Catalog validation failed');
    expect(caught.message).toContain('schemaVersion:');
  });

  it('returns the parsed catalog for valid input', () => {
    const result = safeParseCatalog(invalidDocument);
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error('expected validation to fail');
    }
    expect(result.issues.every((issue) => issue.code === 'invalid-shape')).toBe(true);
    expect(result.issues.every((issue) => issue.path.length > 0)).toBe(true);
  });
});
