import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { safeParseCatalog } from '@cf-viz/catalog';
import { describe, expect, it } from 'vitest';

import shippedSources from '../config/sources.json' with { type: 'json' };
import { loadSourceConfig, parseSourceConfig, safeParseSourceConfig } from './config.js';
import { CrawlError } from './errors.js';
import invalidBadSlug from './fixtures/invalid-bad-slug.json' with { type: 'json' };
import invalidDuplicateId from './fixtures/invalid-duplicate-id.json' with { type: 'json' };
import invalidDuplicateUrl from './fixtures/invalid-duplicate-url.json' with { type: 'json' };
import invalidHttpProtocol from './fixtures/invalid-http-protocol.json' with { type: 'json' };
import invalidKnobRange from './fixtures/invalid-knob-range.json' with { type: 'json' };
import invalidOffDomain from './fixtures/invalid-off-domain.json' with { type: 'json' };
import invalidPageKindHost from './fixtures/invalid-page-kind-host.json' with { type: 'json' };
import invalidShape from './fixtures/invalid-shape.json' with { type: 'json' };
import validSources from './fixtures/valid-sources.json' with { type: 'json' };

function first<T>(items: readonly T[]): T {
  const item = items[0];
  if (item === undefined) {
    throw new Error('expected at least one item');
  }
  return item;
}

const invalidCases = [
  { name: 'invalid-shape', fixture: invalidShape as unknown, path: 'sources' },
  { name: 'invalid-bad-slug', fixture: invalidBadSlug as unknown, path: 'sources[0].id' },
  {
    name: 'invalid-http-protocol',
    fixture: invalidHttpProtocol as unknown,
    path: 'sources[0].url',
  },
  { name: 'invalid-off-domain', fixture: invalidOffDomain as unknown, path: 'sources[0].url' },
  {
    name: 'invalid-page-kind-host',
    fixture: invalidPageKindHost as unknown,
    path: 'sources[0].pageKind',
  },
  { name: 'invalid-duplicate-id', fixture: invalidDuplicateId as unknown, path: 'sources[1].id' },
  {
    name: 'invalid-duplicate-url',
    fixture: invalidDuplicateUrl as unknown,
    path: 'sources[1].url',
  },
  { name: 'invalid-knob-range', fixture: invalidKnobRange as unknown, path: 'fetch.concurrency' },
] as const;

const outOfRangeKnobs = [
  { knob: 'timeoutMs', value: 100 },
  { knob: 'maxRetries', value: 10 },
  { knob: 'minRequestIntervalMs', value: 50 },
] as const;

describe('safeParseSourceConfig', () => {
  it('accepts the valid fixture and echoes the config unchanged', () => {
    const result = safeParseSourceConfig(validSources);
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error('expected validation to succeed');
    }
    expect(result.config).toEqual(validSources);
  });

  it.each(invalidCases)('rejects $name with an issue at $path', ({ fixture, path }) => {
    const result = safeParseSourceConfig(fixture);
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error('expected validation to fail');
    }
    expect(result.issues).toHaveLength(1);
    expect(first(result.issues).path).toBe(path);
  });

  it.each(outOfRangeKnobs)('rejects out-of-range fetch.$knob', ({ knob, value }) => {
    const config = structuredClone(validSources);
    config.fetch[knob] = value;
    const result = safeParseSourceConfig(config);
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error('expected validation to fail');
    }
    expect(result.issues).toHaveLength(1);
    expect(first(result.issues).path).toBe(`fetch.${knob}`);
  });

  it('rejects duplicate allowedHosts entries', () => {
    const config = structuredClone(validSources);
    config.allowedHosts = ['www.cloudflare.com', 'www.cloudflare.com'];
    // Keep only www sources so the narrowed host list stays the sole issue.
    config.sources = config.sources.filter((source) => source.pageKind !== 'developer-docs');
    const result = safeParseSourceConfig(config);
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error('expected validation to fail');
    }
    expect(result.issues).toHaveLength(1);
    expect(first(result.issues).path).toBe('allowedHosts');
  });
});

describe('parseSourceConfig', () => {
  it('accepts the shipped config file', () => {
    const config = parseSourceConfig(shippedSources);
    expect(config.sources).toHaveLength(6);
    expect(config).toEqual(shippedSources);
  });

  it('throws a stage-tagged CrawlError embedding the issue paths', () => {
    let caught: unknown;
    try {
      parseSourceConfig(invalidBadSlug);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CrawlError);
    if (!(caught instanceof CrawlError)) {
      throw new Error('expected a CrawlError');
    }
    expect(caught.stage).toBe('config');
    expect(caught.url).toBeUndefined();
    expect(caught.message).toContain('sources[0].id');
  });
});

describe('config to catalog handoff', () => {
  it('shipped seed id, url, and pageKind form a valid catalog source', () => {
    const seed = first(shippedSources.sources);
    const result = safeParseCatalog({
      schemaVersion: '1',
      generatedAt: '2026-07-14T00:00:00Z',
      sources: [
        { ...seed, title: 'Cloudflare products overview', retrievedAt: '2026-07-14T00:00:00Z' },
      ],
      productFamilies: [],
      products: [],
      solutions: [],
      useCases: [],
      relationships: [],
    });
    expect(result.success).toBe(true);
  });
});

describe('loadSourceConfig', () => {
  async function scratchFile(name: string, content: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'cf-viz-config-'));
    const filePath = join(dir, name);
    await writeFile(filePath, content, 'utf8');
    return filePath;
  }

  it('loads and validates a config file from disk', async () => {
    const filePath = await scratchFile('sources.json', JSON.stringify(validSources));
    const config = await loadSourceConfig(filePath);
    expect(config).toEqual(validSources);
  });

  it('rejects broken JSON with a CrawlError at stage config', async () => {
    const filePath = await scratchFile('broken.json', '{ "allowedHosts": [');
    const promise = loadSourceConfig(filePath);
    await expect(promise).rejects.toBeInstanceOf(CrawlError);
    await expect(promise).rejects.toMatchObject({ stage: 'config' });
  });

  it('rejects a nonexistent path with a CrawlError at stage config', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cf-viz-config-'));
    const promise = loadSourceConfig(join(dir, 'missing.json'));
    await expect(promise).rejects.toBeInstanceOf(CrawlError);
    await expect(promise).rejects.toMatchObject({ stage: 'config' });
  });
});
