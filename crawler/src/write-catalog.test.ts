/**
 * Empirical tests for writeCatalogAtomically on macOS/APFS.
 *
 * Failure injection is REAL filesystem state, no mocking:
 * - serialization failure: a BigInt value (JSON.stringify throws TypeError);
 * - staging-write failure: target directory chmod 0o555 (open 'wx' EACCES);
 * - rename failure: target path occupied by a non-empty DIRECTORY
 *   (rename(file, dir) fails EISDIR on macOS while the write itself
 *   succeeded — exercises the post-write cleanup branch without mocks);
 * - mkdir failure: a parent path component that is a regular FILE.
 *
 * All tests run on mkdtemp sandboxes only — never the repo's own
 * web/public/data.
 */
import { mkdtempSync } from 'node:fs';
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Catalog } from '@cf-viz/catalog';
import { afterEach, describe, expect, it } from 'vitest';

import { CrawlError } from './errors.js';
import { serializeCatalog, writeCatalogAtomically } from './write-catalog.js';

const PREVIOUS_BYTES = Buffer.from('{\n  "schemaVersion": "previous"\n}\n', 'utf8');

const SAMPLE_CATALOG: Catalog = {
  schemaVersion: '1',
  generatedAt: '2026-07-14T00:00:00.000Z',
  sources: [
    {
      id: 'products-overview',
      url: 'https://www.cloudflare.com/products/',
      pageKind: 'marketing-overview',
      title: 'Cloudflare products',
      retrievedAt: '2026-07-14T00:00:00.000Z',
    },
  ],
  productFamilies: [
    {
      id: 'application-security',
      name: 'Application security',
      summary: 'Protect applications at the edge.',
      sourceIds: ['products-overview'],
    },
  ],
  products: [
    {
      id: 'waf',
      name: 'Cloudflare WAF',
      summary: '웹 방화벽',
      familyId: 'application-security',
      sourceIds: ['products-overview'],
    },
  ],
  solutions: [],
  useCases: [],
  relationships: [],
};

let sandbox: string | undefined;
const restoreModes: { dir: string; mode: number }[] = [];

function makeSandbox(): string {
  sandbox = mkdtempSync(path.join(tmpdir(), 'issue5-write-'));
  return sandbox;
}

afterEach(async () => {
  // Restore modes BEFORE removing the sandbox, or rm itself fails EACCES.
  for (const { dir, mode } of restoreModes.splice(0)) {
    await chmod(dir, mode);
  }
  if (sandbox !== undefined) {
    await rm(sandbox, { recursive: true, force: true });
    sandbox = undefined;
  }
});

async function expectWriteFailure(promise: Promise<void>): Promise<CrawlError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(CrawlError);
  const crawlError = error as CrawlError;
  expect(crawlError.stage).toBe('write');
  return crawlError;
}

describe('writeCatalogAtomically success path', () => {
  it('creates the target directory, writes exact bytes, leaves no staging artifacts', async () => {
    const dir = makeSandbox();
    const target = path.join(dir, 'data', 'catalog.json');
    await writeCatalogAtomically(SAMPLE_CATALOG, target);

    const written = await readFile(target);
    expect(written.toString('utf8')).toBe(serializeCatalog(SAMPLE_CATALOG));
    // trailing newline, exactly one
    expect(written.subarray(-2).toString('utf8')).toBe('}\n');
    // UTF-8, no BOM: first byte is '{'
    expect(written[0]).toBe(0x7b);
    // non-ASCII survives as real UTF-8
    expect(written.toString('utf8')).toContain('웹 방화벽');
    // no staging leftovers anywhere in the target directory
    expect(await readdir(path.dirname(target))).toEqual(['catalog.json']);
  });

  it('atomically replaces an existing target (new inode, new bytes)', async () => {
    const dir = makeSandbox();
    const target = path.join(dir, 'catalog.json');
    await writeFile(target, PREVIOUS_BYTES);
    const before = await stat(target);

    await writeCatalogAtomically(SAMPLE_CATALOG, target);

    const after = await stat(target);
    expect(after.ino).not.toBe(before.ino); // rename swapped the inode in
    expect((await readFile(target)).toString('utf8')).toBe(serializeCatalog(SAMPLE_CATALOG));
    expect(await readdir(dir)).toEqual(['catalog.json']);
  });
});

describe('determinism', () => {
  it('serializes the same object to identical bytes with construction key order', () => {
    const first = Buffer.from(serializeCatalog(SAMPLE_CATALOG), 'utf8');
    const second = Buffer.from(serializeCatalog(SAMPLE_CATALOG), 'utf8');
    expect(Buffer.compare(first, second)).toBe(0);
    // JSON.stringify emits string keys in insertion (construction) order
    const text = first.toString('utf8');
    expect(text.indexOf('"schemaVersion"')).toBeLessThan(text.indexOf('"generatedAt"'));
    expect(text.indexOf('"generatedAt"')).toBeLessThan(text.indexOf('"sources"'));
    expect(text.indexOf('"sources"')).toBeLessThan(text.indexOf('"relationships"'));
  });

  it('produces identical bytes across two full write cycles', async () => {
    const dir = makeSandbox();
    const a = path.join(dir, 'a.json');
    const b = path.join(dir, 'b.json');
    await writeCatalogAtomically(SAMPLE_CATALOG, a);
    await writeCatalogAtomically(SAMPLE_CATALOG, b);
    expect(Buffer.compare(await readFile(a), await readFile(b))).toBe(0);
  });
});

describe('failure paths preserve the previous dataset byte-for-byte', () => {
  it('serialization failure (BigInt) touches nothing', async () => {
    const dir = makeSandbox();
    const target = path.join(dir, 'catalog.json');
    await writeFile(target, PREVIOUS_BYTES);

    // The cast exists ONLY to reach the serializer's runtime guard: the
    // Catalog type can never hold a BigInt, but the guard must still catch
    // a non-serializable value arriving through a bug upstream.
    const poisoned = { ...SAMPLE_CATALOG, generatedAt: 1n } as unknown as Catalog;
    const error = await expectWriteFailure(writeCatalogAtomically(poisoned, target));
    expect(error.message).not.toContain('schemaVersion'); // no body in message
    expect(error.message).not.toContain('웹');

    expect(Buffer.compare(await readFile(target), PREVIOUS_BYTES)).toBe(0);
    expect(await readdir(dir)).toEqual(['catalog.json']);
  });

  it('staging write failure (read-only target dir, EACCES) leaves target and no staging', async () => {
    const dir = makeSandbox();
    const target = path.join(dir, 'catalog.json');
    await writeFile(target, PREVIOUS_BYTES);
    await chmod(dir, 0o555);
    restoreModes.push({ dir, mode: 0o755 });

    const error = await expectWriteFailure(writeCatalogAtomically(SAMPLE_CATALOG, target));
    expect(error.message).toContain(target);
    expect(error.message).not.toContain('schemaVersion'); // no body in message

    await chmod(dir, 0o755);
    expect(Buffer.compare(await readFile(target), PREVIOUS_BYTES)).toBe(0);
    expect(await readdir(dir)).toEqual(['catalog.json']);
  });

  it('rename failure (target occupied by a non-empty directory) cleans staging', async () => {
    const dir = makeSandbox();
    const target = path.join(dir, 'catalog.json');
    await mkdir(target);
    await writeFile(path.join(target, 'occupant.txt'), 'keep');

    const error = await expectWriteFailure(writeCatalogAtomically(SAMPLE_CATALOG, target));
    expect(error.message).toContain(target);
    expect(error.message).not.toContain('schemaVersion');

    // the occupying directory and its content are intact
    expect(await readdir(target)).toEqual(['occupant.txt']);
    // staging file was removed: only the directory remains beside it
    expect(await readdir(dir)).toEqual(['catalog.json']);
  });

  it('mkdir failure (parent path component is a file) touches nothing', async () => {
    const dir = makeSandbox();
    const blocker = path.join(dir, 'data');
    await writeFile(blocker, 'not a directory');
    const target = path.join(blocker, 'catalog.json');

    const error = await expectWriteFailure(writeCatalogAtomically(SAMPLE_CATALOG, target));
    expect(error.message).toContain(target);
    expect(error.message).not.toContain('schemaVersion');

    expect((await readFile(blocker)).toString('utf8')).toBe('not a directory');
    expect(await readdir(dir)).toEqual(['data']);
  });
});
