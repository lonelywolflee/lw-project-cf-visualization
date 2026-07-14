/** Machine-readable category of one catalog validation issue. */
export type CatalogIssueCode =
  | 'invalid-shape'
  | 'duplicate-id'
  | 'unknown-source-reference'
  | 'unknown-entity-reference'
  | 'duplicate-relationship';

/** One actionable validation problem at a concrete document location. */
export interface CatalogIssue {
  readonly code: CatalogIssueCode;
  readonly path: string;
  readonly message: string;
}

/** Formats a zod issue path into a pointer like `products[2].familyId`. */
export function formatIssuePath(path: readonly PropertyKey[]): string {
  let formatted = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      formatted += `[${String(segment)}]`;
    } else if (formatted === '') {
      formatted = String(segment);
    } else {
      formatted += `.${String(segment)}`;
    }
  }
  return formatted;
}

/**
 * Thrown by {@link parseCatalog} and {@link parseCuratedData}; the message
 * embeds one `path: message` line per issue so CLI output is actionable
 * without unwrapping. `subject` names the document kind in the first line.
 */
export class CatalogValidationError extends Error {
  /** Every issue found, in document order. */
  readonly issues: readonly CatalogIssue[];

  constructor(issues: readonly CatalogIssue[], subject = 'Catalog') {
    const lines = issues.map((issue) => `  ${issue.path}: ${issue.message}`);
    super(
      [`${subject} validation failed with ${String(issues.length)} issue(s):`, ...lines].join('\n'),
    );
    this.name = 'CatalogValidationError';
    this.issues = issues;
  }
}
