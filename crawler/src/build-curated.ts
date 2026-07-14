/**
 * `pnpm build:curated` — normalizes the hand-edited curated source
 * (data/curated/curated.json) into the committed web artifact
 * (web/public/data/curated.json) after validating it against the shared
 * schema and the committed catalog. No network access; any failure leaves
 * the previous artifact byte-for-byte untouched.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { safeParseCatalog, type CatalogIssue } from '@cf-viz/catalog';

import { buildCuratedArtifact } from './curated-build.js';
import { writeFileAtomically } from './write-catalog.js';

const sourcePath =
  process.argv[2] ?? fileURLToPath(new URL('../../data/curated/curated.json', import.meta.url));
const targetPath =
  process.argv[3] ?? fileURLToPath(new URL('../../web/public/data/curated.json', import.meta.url));
const catalogPath =
  process.argv[4] ?? fileURLToPath(new URL('../../web/public/data/catalog.json', import.meta.url));

type Stage = 'catalog-read' | 'catalog-parse' | 'catalog-validate' | 'read' | 'parse' | 'write';

function fail(stage: Stage, filePath: string, message: string): never {
  console.error(`build:curated failed at stage "${stage}" for ${filePath}: ${message}`);
  process.exit(1);
}

function failWithIssues(
  stage: 'catalog-validate' | 'validate',
  filePath: string,
  issues: readonly CatalogIssue[],
): never {
  console.error(`build:curated failed at stage "${stage}" for ${filePath}:`);
  for (const issue of issues) {
    console.error(`  [${issue.code}] ${issue.path}: ${issue.message}`);
  }
  process.exit(1);
}

async function readJson(filePath: string, readStage: Stage, parseStage: Stage): Promise<unknown> {
  const raw = await readFile(filePath, 'utf8').catch((error: unknown) =>
    fail(readStage, filePath, error instanceof Error ? error.message : String(error)),
  );
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    fail(parseStage, filePath, error instanceof Error ? error.message : String(error));
  }
}

const catalogDocument = await readJson(catalogPath, 'catalog-read', 'catalog-parse');
const catalogResult = safeParseCatalog(catalogDocument);
if (!catalogResult.success) {
  failWithIssues('catalog-validate', catalogPath, catalogResult.issues);
}

const sourceDocument = await readJson(sourcePath, 'read', 'parse');
const build = buildCuratedArtifact(sourceDocument, catalogResult.data);
if (!build.success) {
  failWithIssues('validate', sourcePath, build.issues);
}

try {
  await writeFileAtomically(build.body, targetPath);
} catch (error) {
  fail('write', targetPath, error instanceof Error ? error.message : String(error));
}

const counts = [
  `${String(build.data.products.length)} products`,
  `${String(build.data.compositions.length)} compositions`,
  `${String(build.data.pricing.length)} pricing entries`,
  `${String(build.data.learningNotes.length)} learning notes`,
  `${String(build.data.scenarios.length)} scenarios`,
  `${String(build.data.narration.length)} narration stops`,
].join(', ');
console.log(
  `curated.json built (schemaVersion ${build.data.schemaVersion}): ${counts} → ${targetPath}`,
);
