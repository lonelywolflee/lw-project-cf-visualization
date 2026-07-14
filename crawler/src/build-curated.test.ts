/**
 * End-to-end tests for the `pnpm build:curated` script. The pipeline logic
 * is unit-tested in curated-build.test.ts, so the contract under test is
 * the process one: exit codes, stage-tagged stderr, the summary line, and
 * that a failed run leaves the previous artifact byte-for-byte untouched.
 * Each case runs the real script in a child process against temp files.
 */
import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL('./build-curated.ts', import.meta.url));
const tsxBin = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));
const sandbox = mkdtempSync(path.join(tmpdir(), 'build-curated-'));

const VALID_CATALOG = {
  schemaVersion: '1',
  generatedAt: '2026-07-14T00:00:00Z',
  sources: [
    {
      id: 'waf-product-page',
      url: 'https://www.cloudflare.com/application-services/products/waf/',
      pageKind: 'marketing-product',
      title: 'Cloudflare Web Application Firewall',
      retrievedAt: '2026-07-14T00:00:00Z',
    },
  ],
  productFamilies: [
    {
      id: 'application-security',
      name: 'Application security',
      summary: 'Products that protect web applications and APIs at the edge.',
      sourceIds: ['waf-product-page'],
    },
  ],
  products: [
    {
      id: 'waf',
      name: 'Web Application Firewall',
      summary: 'Filters and blocks malicious HTTP traffic.',
      familyId: 'application-security',
      sourceIds: ['waf-product-page'],
    },
  ],
  solutions: [],
  useCases: [],
  relationships: [],
};

const VALID_CURATED_SOURCE = {
  schemaVersion: '1',
  // Key order is deliberately non-canonical: the artifact must not mirror it.
  learningNotes: [],
  products: [
    {
      verifiedAt: '2026-07-14T00:00:00Z',
      sourceUrl: 'https://www.cloudflare.com/application-services/products/waf/',
      roleKo: '웹 공격 패턴을 차단합니다.',
      placements: [{ layer: 'application-security', lane: 'public-web' }],
      productId: 'waf',
    },
  ],
  compositions: [],
  pricing: [],
};

interface RunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runScript(args: readonly string[]): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(tsxBin, [scriptPath, ...args]);
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return {
      exitCode: failure.code ?? -1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

async function writeCase(
  name: string,
  files: { source?: unknown; sourceRaw?: string; catalog?: unknown },
): Promise<{ source: string; target: string; catalog: string }> {
  const dir = path.join(sandbox, name);
  const paths = {
    source: path.join(dir, 'curated.json'),
    target: path.join(dir, 'artifact.json'),
    catalog: path.join(dir, 'catalog.json'),
  };
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await writeFile(
    paths.source,
    files.sourceRaw ?? JSON.stringify(files.source ?? VALID_CURATED_SOURCE),
    'utf8',
  );
  await writeFile(paths.catalog, JSON.stringify(files.catalog ?? VALID_CATALOG), 'utf8');
  return paths;
}

afterAll(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe('build-curated CLI', () => {
  it('exits 0, writes the canonical artifact, and prints a summary', async () => {
    const paths = await writeCase('success', {});
    const result = await runScript([paths.source, paths.target, paths.catalog]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('curated.json built');
    expect(result.stdout).toContain('1 products');
    const artifact = await readFile(paths.target, 'utf8');
    expect(artifact.endsWith('\n')).toBe(true);
    const parsed: unknown = JSON.parse(artifact);
    expect(parsed).toEqual({
      schemaVersion: '1',
      learningNotes: [],
      products: [
        {
          productId: 'waf',
          roleKo: '웹 공격 패턴을 차단합니다.',
          placements: [{ lane: 'public-web', layer: 'application-security' }],
          sourceUrl: 'https://www.cloudflare.com/application-services/products/waf/',
          verifiedAt: '2026-07-14T00:00:00Z',
        },
      ],
      compositions: [],
      pricing: [],
    });
    // Canonical key order, not the scrambled author order.
    expect(artifact.indexOf('"productId"')).toBeLessThan(artifact.indexOf('"roleKo"'));
    expect(artifact.indexOf('"lane"')).toBeLessThan(artifact.indexOf('"layer"'));
  });

  it('is byte-identical across repeated runs', async () => {
    const paths = await writeCase('deterministic', {});
    await runScript([paths.source, paths.target, paths.catalog]);
    const firstBytes = await readFile(paths.target, 'utf8');
    await runScript([paths.source, paths.target, paths.catalog]);
    expect(await readFile(paths.target, 'utf8')).toBe(firstBytes);
  });

  it('exits 1 at stage "validate" and keeps the previous artifact on invalid source', async () => {
    const paths = await writeCase('invalid-source', {
      source: { schemaVersion: '1', products: [], compositions: [], pricing: [], extra: true },
    });
    await writeFile(paths.target, 'PREVIOUS ARTIFACT\n', 'utf8');
    const result = await runScript([paths.source, paths.target, paths.catalog]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('stage "validate"');
    expect(result.stderr).toContain('extra');
    expect(await readFile(paths.target, 'utf8')).toBe('PREVIOUS ARTIFACT\n');
  });

  it('exits 1 at stage "validate" for a reference to an unknown catalog id', async () => {
    const paths = await writeCase('unknown-reference', {
      source: {
        ...VALID_CURATED_SOURCE,
        pricing: [
          {
            productId: 'ghost',
            tiers: [{ id: 'free', name: 'Free', monthlyUsd: 0 }],
            sourceUrl: 'https://www.cloudflare.com/plans/',
            verifiedAt: '2026-07-14T00:00:00Z',
          },
        ],
      },
    });
    const result = await runScript([paths.source, paths.target, paths.catalog]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('unknown-entity-reference');
    expect(result.stderr).toContain("'ghost'");
  });

  it('exits 1 at stage "parse" for broken source JSON', async () => {
    const paths = await writeCase('broken-json', { sourceRaw: '{ not json' });
    const result = await runScript([paths.source, paths.target, paths.catalog]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('stage "parse"');
  });

  it('exits 1 at stage "catalog-read" when the catalog is missing', async () => {
    const paths = await writeCase('missing-catalog', {});
    const result = await runScript([
      paths.source,
      paths.target,
      path.join(sandbox, 'missing-catalog', 'nope.json'),
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('stage "catalog-read"');
  });
});
