/**
 * End-to-end tests for the `pnpm validate:data` script. The script is CLI
 * wiring around safeParseCatalog (already unit-tested in @cf-viz/catalog),
 * so the contract under test is the process one: exit code, stage-tagged
 * stderr, and the summary line CI logs show. Each case runs the real script
 * in a child process against a temp file — no network, no repo data.
 */
import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterAll, describe, expect, it } from 'vitest';

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

interface RunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runScript(catalogArg: string): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(tsxBin, [scriptPath, catalogArg]);
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

afterAll(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe('validate-data CLI', () => {
  it('exits 0 and prints entity counts for a valid catalog', async () => {
    const file = path.join(sandbox, 'valid.json');
    await writeFile(file, JSON.stringify(VALID_CATALOG), 'utf8');
    const result = await runScript(file);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('catalog.json is valid');
    expect(result.stdout).toContain('1 products');
  });

  it('exits 1 with a read-stage error for a missing file', async () => {
    const result = await runScript(path.join(sandbox, 'does-not-exist.json'));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('stage "read"');
  });

  it('exits 1 with a parse-stage error for invalid JSON', async () => {
    const file = path.join(sandbox, 'broken.json');
    await writeFile(file, '{ not json', 'utf8');
    const result = await runScript(file);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('stage "parse"');
  });

  it('exits 1 listing schema issues for an invalid catalog', async () => {
    const file = path.join(sandbox, 'invalid.json');
    const broken = { ...VALID_CATALOG, schemaVersion: '999' };
    await writeFile(file, JSON.stringify(broken), 'utf8');
    const result = await runScript(file);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('stage "validate"');
    expect(result.stderr).toContain('schemaVersion');
  });
});
