import type { Catalog } from '@cf-viz/catalog';

import {
  EMPTY_FILTER,
  LAYOUT,
  disconnectedCounts,
  edgesByType,
  filterEdges,
  layoutGraph,
  parseRelationshipParams,
  relationshipEdges,
  selectionDetail,
  toRelationshipQueryParams,
} from './relationship-selectors';

const source = {
  id: 'products-overview',
  url: 'https://www.cloudflare.com/products/',
  pageKind: 'marketing-overview',
  title: 'Our products',
  retrievedAt: '2026-07-14T00:00:00Z',
} as const;

/** Two products, two solutions, two use cases; one product and one solution disconnected. */
const catalog: Catalog = {
  schemaVersion: '1',
  generatedAt: '2026-07-14T00:00:00Z',
  sources: [source],
  productFamilies: [
    { id: 'compute', name: 'Compute', summary: 'Compute products.', sourceIds: [source.id] },
  ],
  products: [
    {
      id: 'workers',
      name: 'Workers',
      summary: 'Serverless compute at the edge.',
      familyId: 'compute',
      sourceIds: [source.id],
    },
    {
      id: 'cdn',
      name: 'CDN',
      summary: 'Content delivery network.',
      familyId: 'compute',
      sourceIds: [source.id],
    },
    {
      id: 'waf',
      name: 'Web Application Firewall',
      summary: 'Filters malicious HTTP traffic.',
      familyId: 'compute',
      sourceIds: [source.id],
    },
  ],
  solutions: [
    { id: 'sase', name: 'SASE', summary: 'Zero trust platform.', sourceIds: [source.id] },
    { id: 'ai', name: 'AI', summary: 'AI solution.', sourceIds: [source.id] },
  ],
  useCases: [
    {
      id: 'edge-compute',
      name: 'Edge compute',
      summary: 'Run code close to users.',
      sourceIds: [source.id],
    },
    {
      id: 'remote-access',
      name: 'Remote access',
      summary: 'Modernize remote access.',
      sourceIds: [source.id],
    },
  ],
  relationships: [
    // Deliberately NOT in display order.
    {
      type: 'solution-use-case',
      fromId: 'sase',
      toId: 'remote-access',
      sourceIds: [source.id],
    },
    {
      type: 'product-use-case',
      fromId: 'workers',
      toId: 'edge-compute',
      sourceIds: [source.id],
    },
    {
      type: 'product-use-case',
      fromId: 'cdn',
      toId: 'edge-compute',
      sourceIds: [source.id],
    },
  ],
};

describe('relationshipEdges', () => {
  it('resolves endpoints and sorts by type, then from-name, then to-name', () => {
    const edges = relationshipEdges(catalog);
    expect(edges.map((edge) => edge.key)).toEqual([
      'product-use-case:cdn:edge-compute',
      'product-use-case:workers:edge-compute',
      'solution-use-case:sase:remote-access',
    ]);
    const first = edges[0]!;
    expect(first.from).toMatchObject({
      kind: 'product',
      id: 'cdn',
      name: 'CDN',
      detailRoute: ['/products', 'cdn'],
    });
    expect(first.to).toMatchObject({ kind: 'use-case', id: 'edge-compute', detailRoute: null });
    expect(first.label).toBe('Product – Use case: CDN → Edge compute');
  });

  it('is deterministic: same catalog, same output', () => {
    expect(relationshipEdges(catalog)).toEqual(relationshipEdges(catalog));
  });
});

describe('parseRelationshipParams', () => {
  it('accepts valid enum values', () => {
    const { filter, dropped } = parseRelationshipParams({
      type: 'product-use-case',
      category: 'solution',
    });
    expect(filter).toEqual({ type: 'product-use-case', category: 'solution' });
    expect(dropped).toEqual([]);
  });

  it('drops invalid values and reports them', () => {
    const { filter, dropped } = parseRelationshipParams({ type: 'bogus', category: 'nope' });
    expect(filter).toEqual(EMPTY_FILTER);
    expect(dropped).toEqual(['type', 'category']);
  });

  it('takes the first occurrence of repeated params', () => {
    const { filter } = parseRelationshipParams({
      type: ['solution-use-case', 'product-use-case'],
    });
    expect(filter.type).toBe('solution-use-case');
  });

  it('round-trips through query params with null for inactive keys', () => {
    expect(toRelationshipQueryParams({ type: 'product-use-case', category: null })).toEqual({
      type: 'product-use-case',
      category: null,
    });
  });
});

describe('filterEdges', () => {
  const edges = relationshipEdges(catalog);

  it('returns everything for the empty filter', () => {
    expect(filterEdges(edges, EMPTY_FILTER)).toEqual(edges);
  });

  it('filters by relationship type', () => {
    const filtered = filterEdges(edges, { type: 'solution-use-case', category: null });
    expect(filtered.map((edge) => edge.key)).toEqual(['solution-use-case:sase:remote-access']);
  });

  it('category keeps edges touching that kind on either endpoint', () => {
    const filtered = filterEdges(edges, { type: null, category: 'use-case' });
    expect(filtered).toHaveLength(3); // every edge touches a use case
    const products = filterEdges(edges, { type: null, category: 'product' });
    expect(products.map((edge) => edge.from.id)).toEqual(['cdn', 'workers']);
  });

  it('composes type AND category', () => {
    const filtered = filterEdges(edges, { type: 'product-use-case', category: 'solution' });
    expect(filtered).toEqual([]);
  });
});

describe('disconnectedCounts', () => {
  it('counts entities with no edge at all, per kind', () => {
    expect(disconnectedCounts(catalog)).toEqual({ products: 1, solutions: 1, useCases: 0 });
  });

  it('counts everything when there are no relationships', () => {
    expect(disconnectedCounts({ ...catalog, relationships: [] })).toEqual({
      products: 3,
      solutions: 2,
      useCases: 2,
    });
  });
});

describe('layoutGraph', () => {
  const edges = relationshipEdges(catalog);

  it('places each kind in its own column, display-ordered top to bottom', () => {
    const graph = layoutGraph(edges);
    const byKey = new Map(graph.nodes.map((node) => [node.key, node]));

    const cdn = byKey.get('product:cdn')!;
    const workers = byKey.get('product:workers')!;
    expect(cdn.x).toBe(LAYOUT.columnX['product']);
    expect(workers.x).toBe(LAYOUT.columnX['product']);
    expect(cdn.y).toBeLessThan(workers.y); // CDN before Workers

    expect(byKey.get('use-case:edge-compute')!.x).toBe(LAYOUT.columnX['use-case']);
    expect(byKey.get('solution:sase')!.x).toBe(LAYOUT.columnX['solution']);
  });

  it('only lays out connected nodes (disconnected entities never appear)', () => {
    const graph = layoutGraph(edges);
    expect(graph.nodes.map((node) => node.key).sort()).toEqual([
      'product:cdn',
      'product:workers',
      'solution:sase',
      'use-case:edge-compute',
      'use-case:remote-access',
    ]);
  });

  it('produces one path per edge and a height that fits the tallest column', () => {
    const graph = layoutGraph(edges);
    expect(graph.edges).toHaveLength(edges.length);
    for (const edge of graph.edges) {
      expect(edge.path).toMatch(/^M [\d. ]+ C /);
    }
    // Tallest column has 2 rows.
    const rowPitch = LAYOUT.nodeHeight + LAYOUT.rowGap;
    expect(graph.viewBoxHeight).toBe(2 * rowPitch - LAYOUT.rowGap + LAYOUT.padding * 2);
  });

  it('is a pure function: same edges in, identical coordinates out', () => {
    expect(layoutGraph(edges)).toEqual(layoutGraph(edges));
  });

  it('reflows deterministically when the filter shrinks the edge set', () => {
    const filtered = filterEdges(edges, { type: 'product-use-case', category: null });
    const graph = layoutGraph(filtered);
    expect(graph.nodes.map((node) => node.key)).not.toContain('solution:sase');
    expect(graph.nodes.map((node) => node.key)).not.toContain('use-case:remote-access');
  });

  it('truncates long names for the box label only', () => {
    const graph = layoutGraph(
      relationshipEdges({
        ...catalog,
        relationships: [
          {
            type: 'product-use-case',
            fromId: 'waf',
            toId: 'edge-compute',
            sourceIds: [source.id],
          },
        ],
      }),
    );
    const waf = graph.nodes.find((node) => node.id === 'waf')!;
    expect(waf.name).toBe('Web Application Firewall');
    expect(waf.displayName.length).toBeLessThanOrEqual(LAYOUT.maxLabelLength);
  });

  it('handles an empty edge list', () => {
    const graph = layoutGraph([]);
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });
});

describe('edgesByType', () => {
  it('groups filtered edges by type and omits empty groups', () => {
    const groups = edgesByType(relationshipEdges(catalog));
    expect(groups.map((group) => group.type)).toEqual(['product-use-case', 'solution-use-case']);
    expect(groups[0]!.edges).toHaveLength(2);
    expect(groups[0]!.label).toBe('Product – Use case');
  });
});

describe('selectionDetail', () => {
  const edges = relationshipEdges(catalog);

  it('resolves an edge selection with its sources', () => {
    const detail = selectionDetail(catalog, edges, {
      kind: 'edge',
      key: 'product-use-case:workers:edge-compute',
    });
    expect(detail?.kind).toBe('edge');
    if (detail?.kind !== 'edge') return;
    expect(detail.detail.edge.from.name).toBe('Workers');
    expect(detail.detail.sources.map((s) => s.url)).toEqual([source.url]);
  });

  it('resolves a node selection with every touching edge', () => {
    const detail = selectionDetail(catalog, edges, { kind: 'node', key: 'use-case:edge-compute' });
    expect(detail?.kind).toBe('node');
    if (detail?.kind !== 'node') return;
    expect(detail.detail.node.name).toBe('Edge compute');
    expect(detail.detail.edges.map((edge) => edge.from.id)).toEqual(['cdn', 'workers']);
  });

  it('returns undefined when the filter hid the selected edge', () => {
    const filtered = filterEdges(edges, { type: 'solution-use-case', category: null });
    const detail = selectionDetail(catalog, filtered, {
      kind: 'edge',
      key: 'product-use-case:workers:edge-compute',
    });
    expect(detail).toBeUndefined();
  });

  it('returns undefined for a null selection', () => {
    expect(selectionDetail(catalog, edges, null)).toBeUndefined();
  });
});
