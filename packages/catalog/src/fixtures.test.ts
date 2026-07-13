import { describe, expect, it } from 'vitest';

import invalidDuplicateId from './fixtures/invalid-duplicate-id.json' with { type: 'json' };
import invalidEmptyRequired from './fixtures/invalid-empty-required.json' with { type: 'json' };
import invalidRelationshipType from './fixtures/invalid-relationship-type.json' with { type: 'json' };
import invalidSchemaVersion from './fixtures/invalid-schema-version.json' with { type: 'json' };
import invalidUnknownEntityReference from './fixtures/invalid-unknown-entity-reference.json' with { type: 'json' };
import invalidUnknownSourceReference from './fixtures/invalid-unknown-source-reference.json' with { type: 'json' };
import invalidUrlDomain from './fixtures/invalid-url-domain.json' with { type: 'json' };
import validMinimal from './fixtures/valid-minimal.json' with { type: 'json' };
import { safeParseCatalog } from './index.js';

const invalidCases = [
  {
    name: 'invalid-schema-version',
    fixture: invalidSchemaVersion as unknown,
    code: 'invalid-shape',
    path: 'schemaVersion',
  },
  {
    name: 'invalid-empty-required',
    fixture: invalidEmptyRequired as unknown,
    code: 'invalid-shape',
    path: 'products[0].name',
  },
  {
    name: 'invalid-url-domain',
    fixture: invalidUrlDomain as unknown,
    code: 'invalid-shape',
    path: 'sources[0].url',
  },
  {
    name: 'invalid-relationship-type',
    fixture: invalidRelationshipType as unknown,
    code: 'invalid-shape',
    path: 'relationships[0].type',
  },
  {
    name: 'invalid-duplicate-id',
    fixture: invalidDuplicateId as unknown,
    code: 'duplicate-id',
    path: 'products[1].id',
  },
  {
    name: 'invalid-unknown-entity-reference',
    fixture: invalidUnknownEntityReference as unknown,
    code: 'unknown-entity-reference',
    path: 'relationships[0].toId',
  },
  {
    name: 'invalid-unknown-source-reference',
    fixture: invalidUnknownSourceReference as unknown,
    code: 'unknown-source-reference',
    path: 'products[0].sourceIds[0]',
  },
] as const;

describe('catalog fixtures', () => {
  it('accepts the minimal valid fixture and echoes the data unchanged', () => {
    const result = safeParseCatalog(validMinimal);
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error('expected validation to succeed');
    }
    expect(result.data).toEqual(validMinimal);
  });

  it.each(invalidCases)('rejects $name with $code at $path', ({ fixture, code, path }) => {
    const result = safeParseCatalog(fixture);
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error('expected validation to fail');
    }
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ code, path });
  });
});
