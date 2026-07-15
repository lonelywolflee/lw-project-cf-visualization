/**
 * Curated artifact construction: validates the hand-edited source document,
 * cross-checks it against the crawled catalog, and normalizes it into
 * canonical bytes.
 *
 * Normalization rebuilds every object field-by-field in schema order and
 * sorts every order-free array, so the committed artifact is byte-identical
 * regardless of how authors ordered keys or entries in the source file —
 * the same "serializer owns the bytes" contract catalog.json has. Tier
 * arrays keep their authored order: Free → Paid progression is meaning,
 * not noise.
 */
import {
  collectCuratedReferenceIssues,
  safeParseCuratedData,
  type Catalog,
  type CatalogIssue,
  type CuratedComposition,
  type CuratedData,
  type CuratedPricing,
  type CuratedProduct,
  type CuratedScenario,
  type IncludedLimit,
  type LearningNote,
  type NarrationStop,
  type NoteAeLayer,
  type NoteBattlecard,
  type NoteSeLayer,
  type PricingTier,
  type ProductPlacement,
  type UsageMeter,
} from '@cf-viz/catalog';

import { serializeJsonDocument } from './write-catalog.js';

/** Codepoint comparison (never localeCompare); mirrors assemble.ts. */
function compareCodepoints(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function normalizePlacement(placement: ProductPlacement): ProductPlacement {
  return { lane: placement.lane, layer: placement.layer };
}

function normalizeProduct(product: CuratedProduct): CuratedProduct {
  return {
    productId: product.productId,
    roleKo: product.roleKo,
    placements: [...product.placements]
      .sort((a, b) => {
        const byLane = compareCodepoints(a.lane, b.lane);
        return byLane !== 0 ? byLane : compareCodepoints(a.layer, b.layer);
      })
      .map(normalizePlacement),
    sourceUrl: product.sourceUrl,
    verifiedAt: product.verifiedAt,
  };
}

function normalizeComposition(composition: CuratedComposition): CuratedComposition {
  return {
    solutionId: composition.solutionId,
    productIds: [...composition.productIds].sort(compareCodepoints),
    sourceUrl: composition.sourceUrl,
    verifiedAt: composition.verifiedAt,
  };
}

function normalizeLimit(limit: IncludedLimit): IncludedLimit {
  const normalized: IncludedLimit = { metric: limit.metric, included: limit.included };
  if (limit.per !== undefined) {
    normalized.per = limit.per;
  }
  if (limit.labelKo !== undefined) {
    normalized.labelKo = limit.labelKo;
  }
  if (limit.noteKo !== undefined) {
    normalized.noteKo = limit.noteKo;
  }
  return normalized;
}

function normalizeMeter(meter: UsageMeter): UsageMeter {
  const normalized: UsageMeter = {
    metric: meter.metric,
    included: meter.included,
    per: meter.per,
    overage: { usd: meter.overage.usd, perUnits: meter.overage.perUnits },
  };
  if (meter.labelKo !== undefined) {
    normalized.labelKo = meter.labelKo;
  }
  return normalized;
}

function normalizeTier(tier: PricingTier): PricingTier {
  const normalized: PricingTier = { id: tier.id, name: tier.name, monthlyUsd: tier.monthlyUsd };
  if (tier.noteKo !== undefined) {
    normalized.noteKo = tier.noteKo;
  }
  if (tier.featuresKo !== undefined) {
    normalized.featuresKo = [...tier.featuresKo];
  }
  if (tier.limits !== undefined) {
    normalized.limits = tier.limits.map(normalizeLimit);
  }
  if (tier.meters !== undefined) {
    normalized.meters = tier.meters.map(normalizeMeter);
  }
  return normalized;
}

function normalizePricing(pricing: CuratedPricing): CuratedPricing {
  return {
    productId: pricing.productId,
    tiers: pricing.tiers.map(normalizeTier),
    sourceUrl: pricing.sourceUrl,
    verifiedAt: pricing.verifiedAt,
  };
}

function normalizeLearningNote(note: LearningNote): LearningNote {
  const normalized: LearningNote = {
    productId: note.productId,
    whyKo: note.whyKo,
    misconceptionKo: note.misconceptionKo,
    customerQuestionKo: note.customerQuestionKo,
    sourceUrl: note.sourceUrl,
    verifiedAt: note.verifiedAt,
  };
  if (note.analogyKo !== undefined) {
    normalized.analogyKo = note.analogyKo;
  }
  if (note.se !== undefined) {
    const se: NoteSeLayer = {};
    if (note.se.archKo !== undefined) se.archKo = note.se.archKo;
    if (note.se.opsKo !== undefined) se.opsKo = note.se.opsKo;
    if (note.se.limitsKo !== undefined) se.limitsKo = note.se.limitsKo;
    normalized.se = se;
  }
  if (note.ae !== undefined) {
    const ae: NoteAeLayer = {};
    if (note.ae.pitchKo !== undefined) ae.pitchKo = note.ae.pitchKo;
    if (note.ae.valueKo !== undefined) ae.valueKo = note.ae.valueKo;
    if (note.ae.objections !== undefined) {
      ae.objections = note.ae.objections.map((objection) => ({ q: objection.q, a: objection.a }));
    }
    normalized.ae = ae;
  }
  if (note.battlecard !== undefined) {
    normalized.battlecard = [...note.battlecard]
      .sort((a, b) => compareCodepoints(a.competitor, b.competitor))
      .map((card) => {
        const normalizedCard: NoteBattlecard = {
          competitor: card.competitor,
          vsKo: card.vsKo,
          grounding: card.grounding,
        };
        if (card.sourceUrl !== undefined) normalizedCard.sourceUrl = card.sourceUrl;
        return normalizedCard;
      });
  }
  return normalized;
}

function normalizeScenario(scenario: CuratedScenario): CuratedScenario {
  const normalized: CuratedScenario = {
    id: scenario.id,
    titleKo: scenario.titleKo,
    situationKo: scenario.situationKo,
    productIds: [...scenario.productIds].sort(compareCodepoints),
    sourceUrl: scenario.sourceUrl,
    verifiedAt: scenario.verifiedAt,
  };
  if (scenario.talkTrackKo !== undefined) {
    normalized.talkTrackKo = scenario.talkTrackKo;
  }
  return normalized;
}

function normalizeNarrationStop(stop: NarrationStop): NarrationStop {
  return {
    productId: stop.productId,
    captionKo: stop.captionKo,
    sourceUrl: stop.sourceUrl,
    verifiedAt: stop.verifiedAt,
  };
}

/**
 * Canonical form of a valid curated dataset: collections sorted by their
 * entry id, placements by lane/layer, composition members by id; every
 * object rebuilt in schema key order. Narration keeps its authored order —
 * the array order IS the journey (the pricing-tier rule). Idempotent.
 */
export function normalizeCuratedData(curated: CuratedData): CuratedData {
  return {
    schemaVersion: curated.schemaVersion,
    products: [...curated.products]
      .sort((a, b) => compareCodepoints(a.productId, b.productId))
      .map(normalizeProduct),
    compositions: [...curated.compositions]
      .sort((a, b) => compareCodepoints(a.solutionId, b.solutionId))
      .map(normalizeComposition),
    pricing: [...curated.pricing]
      .sort((a, b) => compareCodepoints(a.productId, b.productId))
      .map(normalizePricing),
    learningNotes: [...curated.learningNotes]
      .sort((a, b) => compareCodepoints(a.productId, b.productId))
      .map(normalizeLearningNote),
    scenarios: [...curated.scenarios]
      .sort((a, b) => compareCodepoints(a.id, b.id))
      .map(normalizeScenario),
    narration: curated.narration.map(normalizeNarrationStop),
  };
}

/** Discriminated result of {@link buildCuratedArtifact}. */
export type CuratedBuildResult =
  | { readonly success: true; readonly data: CuratedData; readonly body: string }
  | { readonly success: false; readonly issues: readonly CatalogIssue[] };

/**
 * Full curated pipeline shared by `pnpm build:curated` and the freshness
 * check in `pnpm validate:data`: shape + internal integrity, catalog
 * cross-references, then canonical serialization. Pure — no filesystem.
 */
export function buildCuratedArtifact(
  sourceDocument: unknown,
  catalog: Catalog,
): CuratedBuildResult {
  const parsed = safeParseCuratedData(sourceDocument);
  if (!parsed.success) {
    return { success: false, issues: parsed.issues };
  }
  const referenceIssues = collectCuratedReferenceIssues(parsed.data, catalog);
  if (referenceIssues.length > 0) {
    return { success: false, issues: referenceIssues };
  }
  const data = normalizeCuratedData(parsed.data);
  return { success: true, data, body: serializeJsonDocument(data) };
}
