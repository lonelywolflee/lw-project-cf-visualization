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
  idSlugSchema,
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
export {
  CURATED_LANES,
  CURATED_LANE_LAYERS,
  CURATED_SCHEMA_VERSION,
  curatedDataSchema,
  type CuratedComposition,
  type CuratedData,
  type CuratedLane,
  type CuratedLayer,
  type CuratedPricing,
  type CuratedProduct,
  type CuratedScenario,
  type IncludedLimit,
  type LearningNote,
  type NarrationStop,
  type PricingTier,
  type ProductPlacement,
  type UsageMeter,
} from './curated-schema.js';
export { collectCuratedReferenceIssues } from './curated-integrity.js';
export {
  parseCuratedData,
  safeParseCuratedData,
  type CuratedParseResult,
} from './curated-parse.js';
