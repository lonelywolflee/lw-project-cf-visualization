/**
 * Atomic, deterministic write of the catalog file.
 *
 * Strategy (empirically verified on macOS/APFS, Node 24):
 * - Serialize FIRST, so a serialization failure has zero filesystem effect.
 * - Stage as a dot-prefixed sibling FILE in the target's own directory
 *   (`.catalog.json.<random>.tmp`). Same directory ⇒ same volume ⇒
 *   fs.rename is a single atomic replace and can never fail with EXDEV,
 *   regardless of where os.tmpdir() lives. A staging *directory* would add
 *   nothing but a second cleanup step and failure surface.
 * - open(..., 'wx') so a leftover path collision is an explicit error
 *   instead of silently reusing a stale artifact.
 * - fsync (FileHandle.sync) before rename: cheap, and prevents a
 *   crash-reordering window where the rename is durable but the data is
 *   not, which could leave a truncated target after power loss. Directory
 *   fsync is deliberately skipped: this is a dev-run CLI whose output is
 *   also committed to git — losing the *rename* to a crash just leaves the
 *   previous valid dataset, which is exactly the contract.
 * - Any failure after staging begins removes the staging file (best
 *   effort) and leaves the target byte-for-byte untouched.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import type { Catalog } from '@cf-viz/catalog';

import { CrawlError } from './errors.js';

/**
 * Canonical serialization: 2-space indent, key order as constructed by
 * assembleCatalog (JSON.stringify preserves string-key insertion order),
 * one trailing newline, UTF-8 without BOM (Node never emits a BOM).
 */
export function serializeCatalog(catalog: Catalog): string {
  // Two distinct non-serializable behaviors, both verified on Node 24:
  // JSON.stringify THROWS TypeError for BigInt values, and RETURNS
  // undefined for undefined/function roots. Both become a stage-'write'
  // CrawlError with zero filesystem effect.
  let body: string | undefined;
  try {
    body = JSON.stringify(catalog, null, 2);
  } catch (cause) {
    throw new CrawlError('[write] catalog is not JSON-serializable', { stage: 'write', cause });
  }
  if (typeof body !== 'string') {
    throw new CrawlError('[write] catalog is not JSON-serializable', { stage: 'write' });
  }
  return `${body}\n`;
}

/** Staging path: dot-prefixed sibling of the target, random suffix. */
function stagingPathFor(targetFilePath: string): string {
  const suffix = randomBytes(8).toString('hex');
  return path.join(path.dirname(targetFilePath), `.${path.basename(targetFilePath)}.${suffix}.tmp`);
}

/**
 * Serialize `catalog` and atomically replace `targetFilePath` with it.
 * On any failure the previous target content is untouched and the staging
 * file is removed (best effort); throws CrawlError at stage 'write'.
 */
export async function writeCatalogAtomically(
  catalog: Catalog,
  targetFilePath: string,
): Promise<void> {
  const body = serializeCatalog(catalog);
  const stagingPath = stagingPathFor(targetFilePath);
  try {
    await mkdir(path.dirname(targetFilePath), { recursive: true });
  } catch (cause) {
    throw writeError(targetFilePath, 'could not create target directory', cause);
  }
  let staged = false;
  try {
    const handle = await open(stagingPath, 'wx', 0o644);
    staged = true;
    try {
      await handle.writeFile(body, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(stagingPath, targetFilePath);
    staged = false;
  } catch (cause) {
    if (staged) {
      try {
        await rm(stagingPath, { force: true });
      } catch {
        // Best effort: the primary failure is what matters; a stranded
        // dot-file next to the target is harmless and named in the message.
      }
    }
    throw writeError(targetFilePath, 'atomic replace failed; previous data kept', cause);
  }
}

/** Stage-'write' CrawlError; message carries the target path, never bodies. */
function writeError(targetFilePath: string, summary: string, cause: unknown): CrawlError {
  const reason = cause instanceof Error ? cause.message : 'unknown error';
  return new CrawlError(`[write ${targetFilePath}] ${summary}: ${reason}`, {
    stage: 'write',
    cause,
  });
}
