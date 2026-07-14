import { z } from 'zod';

import { CatalogValidationError, formatIssuePath, type CatalogIssue } from './errors.js';
import { collectIntegrityIssues } from './integrity.js';
import { catalogSchema, type Catalog } from './schema.js';

/** Discriminated result of {@link safeParseCatalog}. */
export type CatalogParseResult =
  | { readonly success: true; readonly data: Catalog }
  | { readonly success: false; readonly issues: readonly CatalogIssue[] };

/**
 * Maps zod issues onto the shared issue contract.
 *
 * Package-internal (not re-exported from the index): shared by the catalog
 * and curated parse pipelines.
 */
export function toShapeIssues(error: z.ZodError): readonly CatalogIssue[] {
  return error.issues.flatMap((issue): readonly CatalogIssue[] => {
    // zod reports unrecognized keys at the object root; point each issue at
    // the offending key instead so the path stays actionable.
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({
        code: 'invalid-shape',
        path: formatIssuePath([...issue.path, key]),
        message: `Unrecognized key: "${key}"`,
      }));
    }
    return [
      {
        code: 'invalid-shape',
        path: formatIssuePath(issue.path),
        message: issue.message,
      },
    ];
  });
}

/**
 * Validates an unknown value as a catalog document without throwing.
 *
 * If shape validation fails, only `invalid-shape` issues are returned and
 * integrity checks are skipped (they need well-formed collections). If the
 * shape passes, ALL referential-integrity issues are collected so a whole
 * batch can be fixed in one run.
 */
export function safeParseCatalog(input: unknown): CatalogParseResult {
  const shape = catalogSchema.safeParse(input);
  if (!shape.success) {
    return { success: false, issues: toShapeIssues(shape.error) };
  }
  const integrityIssues = collectIntegrityIssues(shape.data);
  if (integrityIssues.length > 0) {
    return { success: false, issues: integrityIssues };
  }
  return { success: true, data: shape.data };
}

/**
 * Validates an unknown value as a catalog document.
 *
 * @throws CatalogValidationError listing every issue found.
 */
export function parseCatalog(input: unknown): Catalog {
  const result = safeParseCatalog(input);
  if (!result.success) {
    throw new CatalogValidationError(result.issues);
  }
  return result.data;
}
