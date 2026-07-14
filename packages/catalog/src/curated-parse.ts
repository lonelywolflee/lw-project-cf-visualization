import { collectCuratedIntegrityIssues } from './curated-integrity.js';
import { curatedDataSchema, type CuratedData } from './curated-schema.js';
import { CatalogValidationError, type CatalogIssue } from './errors.js';
import { toShapeIssues } from './parse.js';

/** Discriminated result of {@link safeParseCuratedData}. */
export type CuratedParseResult =
  | { readonly success: true; readonly data: CuratedData }
  | { readonly success: false; readonly issues: readonly CatalogIssue[] };

/**
 * Validates an unknown value as a curated dataset without throwing.
 *
 * Mirrors {@link safeParseCatalog}: shape failures return only
 * `invalid-shape` issues; a valid shape then has ALL internal duplicate-id
 * issues collected. References into the catalog are validated separately
 * with {@link collectCuratedReferenceIssues} (they need a parsed Catalog).
 */
export function safeParseCuratedData(input: unknown): CuratedParseResult {
  const shape = curatedDataSchema.safeParse(input);
  if (!shape.success) {
    return { success: false, issues: toShapeIssues(shape.error) };
  }
  const integrityIssues = collectCuratedIntegrityIssues(shape.data);
  if (integrityIssues.length > 0) {
    return { success: false, issues: integrityIssues };
  }
  return { success: true, data: shape.data };
}

/**
 * Validates an unknown value as a curated dataset.
 *
 * @throws CatalogValidationError listing every issue found.
 */
export function parseCuratedData(input: unknown): CuratedData {
  const result = safeParseCuratedData(input);
  if (!result.success) {
    throw new CatalogValidationError(result.issues, 'Curated data');
  }
  return result.data;
}
