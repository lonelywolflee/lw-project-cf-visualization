import {
  CURATED_LANES,
  CURATED_LANE_LAYERS,
  type Catalog,
  type CuratedData,
  type CuratedLane,
  type CuratedLayer,
  type PricingTier,
  type Product,
} from '@cf-viz/catalog';

import { compareByNameThenId } from '../../core/catalog/catalog-selectors';

/**
 * Pure read-model selectors for the path-and-layer map.
 *
 * Referential integrity assumption: both documents passed their parse
 * pipelines, and `pnpm validate:data` guarantees curated → catalog
 * references for every committed artifact. The one tolerated mismatch is a
 * curated entry whose product id is missing from the catalog (documents
 * load independently, so a mid-deploy skew is possible): such entries join
 * nothing and the product simply stays unplaced.
 */

/** Korean lane chrome; every label the lane band renders. */
export const LANE_LABELS: Record<
  CuratedLane,
  {
    readonly title: string;
    readonly from: string;
    readonly to: string;
    readonly short: string;
    readonly edge: string;
  }
> = {
  'public-web': {
    title: '공개 웹 트래픽',
    from: '방문자',
    to: 'Origin 서버',
    short: '공개 웹',
    edge: 'Cloudflare Edge',
  },
  'zero-trust': {
    title: 'Zero Trust — 직원·사내 트래픽',
    from: '직원',
    to: '사내 앱 · 인터넷',
    short: 'Zero Trust',
    edge: 'Cloudflare One',
  },
};

/**
 * Korean display label per layer. The Record is exhaustive against the
 * curated contract: a layer added to the schema fails compilation here
 * instead of rendering as an unlabeled row.
 */
export const LAYER_LABELS: Record<CuratedLayer, string> = {
  'dns-connectivity': 'DNS · 연결',
  'network-l3-l4': 'L3/L4 네트워크',
  'application-security': 'L7 보안',
  'application-performance': 'L7 성능',
  'compute-platform': '컴퓨팅',
  observability: '관측',
  'access-control': '접근 제어',
  'data-protection': '데이터 보호',
  'network-services': '네트워크 연결',
};

/** One clickable product on the map. */
export interface MapChip {
  readonly id: string;
  readonly name: string;
}

/** Family sub-group inside the compute band. */
export interface MapFamilyGroup {
  readonly familyId: string;
  readonly familyName: string;
  readonly products: readonly MapChip[];
}

/** One layer row of a lane. */
export interface MapLayerView {
  readonly layer: CuratedLayer;
  readonly label: string;
  /** True for the observability side band (monitoring, not on the path). */
  readonly offPath: boolean;
  /** True for the compute band ("Origin 대체" affordance + family groups). */
  readonly originBypass: boolean;
  readonly products: readonly MapChip[];
  /** Family grouping, only for the compute band; null elsewhere. */
  readonly groups: readonly MapFamilyGroup[] | null;
}

/** One lane band with its endpoints. */
export interface MapLaneView {
  readonly lane: CuratedLane;
  readonly title: string;
  readonly from: string;
  readonly to: string;
  /** Title of the box the traffic passes through (Edge / Cloudflare One). */
  readonly edge: string;
  readonly layers: readonly MapLayerView[];
}

/** The whole map view model. */
export interface MapModel {
  readonly lanes: readonly MapLaneView[];
  /** Catalog products without any curated placement, in display order. */
  readonly unplaced: readonly MapChip[];
  readonly placedCount: number;
}

function toChip(product: Product): MapChip {
  return { id: product.id, name: product.name };
}

/** Builds the lane/layer view model from the two validated documents. */
export function buildMapModel(catalog: Catalog, curated: CuratedData): MapModel {
  const productById = new Map(catalog.products.map((product) => [product.id, product]));
  const familyNameById = new Map(catalog.productFamilies.map((family) => [family.id, family.name]));

  const productsByLayer = new Map<CuratedLayer, Product[]>();
  const placedIds = new Set<string>();
  for (const entry of curated.products) {
    const product = productById.get(entry.productId);
    if (product === undefined) continue; // Tolerated skew: stays unplaced.
    placedIds.add(product.id);
    for (const placement of entry.placements) {
      const bucket = productsByLayer.get(placement.layer) ?? [];
      bucket.push(product);
      productsByLayer.set(placement.layer, bucket);
    }
  }

  const lanes = CURATED_LANES.map((lane): MapLaneView => {
    const layers = CURATED_LANE_LAYERS[lane].map((layer): MapLayerView => {
      const products = [...(productsByLayer.get(layer) ?? [])].sort(compareByNameThenId);
      const originBypass = layer === 'compute-platform';
      let groups: readonly MapFamilyGroup[] | null = null;
      if (originBypass) {
        const byFamily = new Map<string, Product[]>();
        for (const product of products) {
          const bucket = byFamily.get(product.familyId) ?? [];
          bucket.push(product);
          byFamily.set(product.familyId, bucket);
        }
        groups = [...byFamily.entries()]
          .map(([familyId, members]) => ({
            familyId,
            familyName: familyNameById.get(familyId) ?? familyId,
            products: members.map(toChip),
          }))
          .sort((a, b) =>
            compareByNameThenId(
              { id: a.familyId, name: a.familyName },
              { id: b.familyId, name: b.familyName },
            ),
          );
      }
      return {
        layer,
        label: LAYER_LABELS[layer],
        offPath: layer === 'observability',
        originBypass,
        products: products.map(toChip),
        groups,
      };
    });
    const chrome = LANE_LABELS[lane];
    return {
      lane,
      title: chrome.title,
      from: chrome.from,
      to: chrome.to,
      edge: chrome.edge,
      layers,
    };
  });

  const unplaced = catalog.products
    .filter((product) => !placedIds.has(product.id))
    .sort(compareByNameThenId)
    .map(toChip);

  return { lanes, unplaced, placedCount: placedIds.size };
}

/** One official source link for the panel. */
export interface PanelSourceLink {
  readonly title: string;
  readonly url: string;
  readonly retrievedAt: string;
}

/** Everything the detail panel renders for one selected product. */
export interface ProductPanelView {
  readonly product: Product;
  readonly familyName: string;
  readonly roleKo: string | null;
  /** e.g. "공개 웹 · L7 보안" per placement, in curated order. */
  readonly placementLabels: readonly string[];
  readonly pricing: {
    readonly tiers: readonly PricingTier[];
    readonly sourceUrl: string;
    readonly verifiedAt: string;
  } | null;
  readonly curatedSource: { readonly url: string; readonly verifiedAt: string } | null;
  readonly sources: readonly PanelSourceLink[];
}

/**
 * Joins the catalog product with its curated knowledge. Unknown ids (the
 * URL is the caller) yield `undefined`; a product without curated coverage
 * yields a view with null curated fields — the panel renders explicit
 * placeholders instead of crashing.
 */
export function productPanel(
  catalog: Catalog,
  curated: CuratedData,
  productId: string,
): ProductPanelView | undefined {
  const product = catalog.products.find((candidate) => candidate.id === productId);
  if (product === undefined) return undefined;

  const familyName =
    catalog.productFamilies.find((family) => family.id === product.familyId)?.name ??
    product.familyId;

  const curatedEntry = curated.products.find((entry) => entry.productId === productId);
  const pricingEntry = curated.pricing.find((entry) => entry.productId === productId);

  const sourceById = new Map(catalog.sources.map((source) => [source.id, source]));
  const sources = product.sourceIds.flatMap((sourceId): PanelSourceLink[] => {
    const source = sourceById.get(sourceId);
    return source === undefined
      ? []
      : [{ title: source.title, url: source.url, retrievedAt: source.retrievedAt }];
  });

  return {
    product,
    familyName,
    roleKo: curatedEntry?.roleKo ?? null,
    placementLabels:
      curatedEntry?.placements.map(
        (placement) => `${LANE_LABELS[placement.lane].short} · ${LAYER_LABELS[placement.layer]}`,
      ) ?? [],
    pricing:
      pricingEntry === undefined
        ? null
        : {
            tiers: pricingEntry.tiers,
            sourceUrl: pricingEntry.sourceUrl,
            verifiedAt: pricingEntry.verifiedAt,
          },
    curatedSource:
      curatedEntry === undefined
        ? null
        : { url: curatedEntry.sourceUrl, verifiedAt: curatedEntry.verifiedAt },
    sources,
  };
}
