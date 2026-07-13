/**
 * Package identity of the shared catalog contract.
 */
export const CATALOG_PACKAGE_NAME = '@cf-viz/catalog';

export {
  APPROVED_SOURCE_HOSTNAMES,
  CATALOG_SCHEMA_VERSION,
  RELATIONSHIP_TYPES,
  SOURCE_PAGE_KINDS,
  catalogSchema,
  type Catalog,
  type Product,
  type ProductFamily,
  type Relationship,
  type RelationshipType,
  type Solution,
  type Source,
  type SourcePageKind,
  type UseCase,
} from './schema.js';
export { CatalogValidationError, type CatalogIssue, type CatalogIssueCode } from './errors.js';
export { parseCatalog, safeParseCatalog, type CatalogParseResult } from './parse.js';
