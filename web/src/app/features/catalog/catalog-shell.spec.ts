import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Catalog, CatalogIssue } from '@cf-viz/catalog';

import type { CatalogState } from '../../core/catalog/catalog-state';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { CatalogShell } from './catalog-shell';

const emptyCatalog: Catalog = {
  schemaVersion: '1',
  generatedAt: '2026-07-14T00:00:00Z',
  sources: [],
  productFamilies: [],
  products: [],
  solutions: [],
  useCases: [],
  relationships: [],
};

const successCatalog: Catalog = {
  ...emptyCatalog,
  sources: [
    {
      id: 'waf-product-page',
      url: 'https://www.cloudflare.com/application-services/products/waf/',
      pageKind: 'marketing-product',
      title: 'Cloudflare Web Application Firewall',
      retrievedAt: '2026-07-14T00:00:00Z',
    },
  ],
  productFamilies: [
    {
      id: 'application-security',
      name: 'Application security',
      summary: 'Products that protect web applications and APIs at the edge.',
      sourceIds: ['waf-product-page'],
    },
  ],
  products: [
    {
      id: 'waf',
      name: 'Web Application Firewall',
      summary: 'Filters and blocks malicious HTTP traffic.',
      familyId: 'application-security',
      sourceIds: ['waf-product-page'],
    },
    {
      id: 'bot-management',
      name: 'Bot Management',
      summary: 'Detects and mitigates automated traffic.',
      familyId: 'application-security',
      sourceIds: ['waf-product-page'],
    },
  ],
  solutions: [
    {
      id: 'application-security-solution',
      name: 'Application Security',
      summary: 'Protects sites, apps, and APIs from attacks.',
      sourceIds: ['waf-product-page'],
    },
  ],
  useCases: [
    {
      id: 'stop-ddos-attacks',
      name: 'Stop DDoS attacks',
      summary: 'Blocks volumetric and targeted denial-of-service traffic.',
      sourceIds: ['waf-product-page'],
    },
  ],
  relationships: [
    {
      type: 'product-solution',
      fromId: 'waf',
      toId: 'application-security-solution',
      sourceIds: ['waf-product-page'],
    },
  ],
};

function makeIssues(count: number): CatalogIssue[] {
  return Array.from({ length: count }, (_, index) => ({
    code: 'invalid-shape',
    path: `products[${index}].name`,
    message: `Issue ${index}`,
  }));
}

describe('CatalogShell', () => {
  let state: WritableSignal<CatalogState>;
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    state = signal<CatalogState>({ kind: 'loading' });
    reload = vi.fn();
    await TestBed.configureTestingModule({
      imports: [CatalogShell],
      providers: [{ provide: CatalogStore, useValue: { state: state.asReadonly(), reload } }],
    }).compileComponents();
  });

  /**
   * The store is stubbed with a plain signal-backed object, so no
   * httpResource request is ever pending and `whenStable()` settles
   * immediately (no `TestBed.tick()`-before-flush dance needed here).
   */
  async function createShell() {
    const fixture = TestBed.createComponent(CatalogShell);
    await fixture.whenStable();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  it('renders the feature heading and announces loading politely', async () => {
    const { element } = await createShell();

    expect(element.querySelector('h1')?.textContent).toContain('Cloudflare 제품 카탈로그');
    const status = element.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.textContent).toContain('불러오는 중');
  });

  it('renders the fetch-error alert with a focusable retry button that reloads', async () => {
    const { fixture, element } = await createShell();

    state.set({ kind: 'fetch-error', status: 503 });
    await fixture.whenStable();

    expect(element.querySelector('[role="alert"]')).not.toBeNull();
    const button = element.querySelector('button');
    expect(button?.textContent).toContain('다시 시도');

    button?.focus();
    expect(document.activeElement).toBe(button);

    button?.click();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('caps the invalid-data issue list at ten entries and reports the rest', async () => {
    const { fixture, element } = await createShell();

    state.set({ kind: 'invalid-data', issues: makeIssues(12) });
    await fixture.whenStable();

    expect(element.querySelector('[role="alert"]')).not.toBeNull();
    const items = element.querySelectorAll('.issue-list li');
    expect(items).toHaveLength(10);
    expect(items[0]?.textContent).toContain('products[0].name');
    expect(items[0]?.textContent).toContain('Issue 0');
    expect(element.textContent).toContain('외 2건의 문제가 더 있습니다.');
    expect(element.querySelector('button')).toBeNull();
  });

  it('lists every issue without a cap notice when ten or fewer', async () => {
    const { fixture, element } = await createShell();

    state.set({ kind: 'invalid-data', issues: makeIssues(3) });
    await fixture.whenStable();

    expect(element.querySelectorAll('.issue-list li')).toHaveLength(3);
    expect(element.textContent).not.toContain('문제가 더 있습니다');
  });

  it('shows the crawl guidance for an empty catalog without an alert role', async () => {
    const { fixture, element } = await createShell();

    state.set({ kind: 'empty', catalog: emptyCatalog });
    await fixture.whenStable();

    expect(element.querySelector('.state-empty')?.textContent).toContain(
      '카탈로그가 비어 있습니다',
    );
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  it('summarises entity counts, sources, and generation time on success', async () => {
    const { fixture, element } = await createShell();

    state.set({ kind: 'success', catalog: successCatalog });
    await fixture.whenStable();

    expect(element.querySelector('#summary-heading')?.textContent).toContain('카탈로그 요약');
    const counts = Array.from(element.querySelectorAll('.summary-counts dd')).map((dd) =>
      dd.textContent?.trim(),
    );
    expect(counts).toEqual(['1', '2', '1', '1', '1']);
    const meta = element.querySelector('.summary-meta')?.textContent;
    expect(meta).toContain('출처 1곳');
    expect(meta).toContain('생성 시각');
  });
});
