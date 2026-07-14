/**
 * End-to-end tests for the `pnpm validate:data` script. The validation
 * logic is unit-tested in @cf-viz/catalog and curated-build.test.ts, so the
 * contract under test is the process one: exit codes, stage-tagged stderr,
 * and the summary lines CI logs show. Each case runs the real script in a
 * child process against temp files — no network, no repo data.
 */
import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { parseCatalog } from '@cf-viz/catalog';
import { afterAll, describe, expect, it } from 'vitest';

import { buildCuratedArtifact } from './curated-build.js';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL('./validate-data.ts', import.meta.url));
const tsxBin = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));
const sandbox = mkdtempSync(path.join(tmpdir(), 'validate-data-'));

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
  learningNotes: [],
  scenarios: [],
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
};

function freshArtifactBody(): string {
  const build = buildCuratedArtifact(VALID_CURATED_SOURCE, parseCatalog(VALID_CATALOG));
  if (!build.success) {
    throw new Error('test fixture curated source must build');
  }
  return build.body;
}

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

interface CasePaths {
  readonly catalog: string;
  readonly source: string;
  readonly artifact: string;
}

async function writeCase(
  name: string,
  files: {
    catalog?: unknown;
    catalogRaw?: string;
    source?: unknown;
    artifact?: string;
  },
): Promise<CasePaths> {
  const dir = path.join(sandbox, name);
  await mkdir(dir, { recursive: true });
  const paths: CasePaths = {
    catalog: path.join(dir, 'catalog.json'),
    source: path.join(dir, 'curated.json'),
    artifact: path.join(dir, 'artifact.json'),
  };
  await writeFile(
    paths.catalog,
    files.catalogRaw ?? JSON.stringify(files.catalog ?? VALID_CATALOG),
    'utf8',
  );
  await writeFile(paths.source, JSON.stringify(files.source ?? VALID_CURATED_SOURCE), 'utf8');
  await writeFile(paths.artifact, files.artifact ?? freshArtifactBody(), 'utf8');
  return paths;
}

function argsOf(paths: CasePaths): readonly string[] {
  return [paths.catalog, paths.source, paths.artifact];
}

afterAll(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe('validate-data CLI', () => {
  it('exits 0 and prints both summary lines for valid, fresh data', async () => {
    const paths = await writeCase('valid', {});
    const result = await runScript(argsOf(paths));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('catalog.json is valid');
    expect(result.stdout).toContain('1 products');
    expect(result.stdout).toContain('curated.json is valid and fresh');
    expect(result.stdout).toContain('0 compositions');
  });

  it('exits 1 with a read-stage error for a missing catalog', async () => {
    const paths = await writeCase('missing-catalog', {});
    const result = await runScript([
      path.join(sandbox, 'missing-catalog', 'nope.json'),
      paths.source,
      paths.artifact,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('stage "read"');
  });

  it('exits 1 with a parse-stage error for invalid catalog JSON', async () => {
    const paths = await writeCase('broken-catalog', { catalogRaw: '{ not json' });
    const result = await runScript(argsOf(paths));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('stage "parse"');
  });

  it('exits 1 listing schema issues for an invalid catalog', async () => {
    const paths = await writeCase('invalid-catalog', {
      catalog: { ...VALID_CATALOG, schemaVersion: '999' },
    });
    const result = await runScript(argsOf(paths));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('stage "validate"');
    expect(result.stderr).toContain('schemaVersion');
  });

  it('exits 1 at stage "curated-read" for a missing curated source', async () => {
    const paths = await writeCase('missing-source', {});
    const result = await runScript([
      paths.catalog,
      path.join(sandbox, 'missing-source', 'nope.json'),
      paths.artifact,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('stage "curated-read"');
  });

  it('exits 1 listing curated issues for an invalid curated source', async () => {
    const paths = await writeCase('invalid-source', {
      source: { ...VALID_CURATED_SOURCE, schemaVersion: '999' },
    });
    const result = await runScript(argsOf(paths));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('stage "curated-validate"');
    expect(result.stderr).toContain('schemaVersion');
  });

  it('exits 1 listing cross-reference issues for unknown catalog ids', async () => {
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
    const result = await runScript(argsOf(paths));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('stage "curated-validate"');
    expect(result.stderr).toContain('unknown-entity-reference');
  });

  it('exits 1 at stage "artifact-read" when the committed artifact is missing', async () => {
    const paths = await writeCase('missing-artifact', {});
    const result = await runScript([
      paths.catalog,
      paths.source,
      path.join(sandbox, 'missing-artifact', 'nope.json'),
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('stage "artifact-read"');
  });

  it('exits 1 at stage "freshness" when the artifact does not match a fresh build', async () => {
    const paths = await writeCase('stale-artifact', { artifact: '{ "schemaVersion": "1" }\n' });
    const result = await runScript(argsOf(paths));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('stage "freshness"');
    expect(result.stderr).toContain('pnpm build:curated');
  });
});
