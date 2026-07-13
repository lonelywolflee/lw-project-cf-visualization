import { computed, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Catalog } from '@cf-viz/catalog';

import { CatalogStore } from '../../core/catalog/catalog-store';
import { ProductDetail } from './product-detail';

const catalog: Catalog = {
  schemaVersion: '1',
  generatedAt: '2026-07-14T00:00:00Z',
  sources: [
    {
      id: 'waf-product-page',
      url: 'https://www.cloudflare.com/application-services/products/waf/',
      pageKind: 'marketing-product',
      title: 'Cloudflare Web Application Firewall',
      retrievedAt: '2026-07-14T08:30:00Z',
    },
    {
      id: 'products-overview',
      url: 'https://www.cloudflare.com/products/',
      pageKind: 'marketing-overview',
      title: 'Our products',
      retrievedAt: '2026-07-14T08:31:00Z',
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
      sourceIds: ['waf-product-page', 'products-overview'],
    },
    {
      id: 'bot-management',
      name: 'Bot Management',
      summary: 'Detects and mitigates automated traffic.',
      familyId: 'application-security',
      sourceIds: ['products-overview'],
    },
  ],
  solutions: [],
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
      type: 'product-use-case',
      fromId: 'waf',
      toId: 'stop-ddos-attacks',
      sourceIds: ['waf-product-page'],
    },
  ],
};

describe('ProductDetail', () => {
  let state: WritableSignal<Catalog | undefined>;

  beforeEach(async () => {
    state = signal<Catalog | undefined>(catalog);
    await TestBed.configureTestingModule({
      imports: [ProductDetail],
      providers: [
        provideRouter([]),
        { provide: CatalogStore, useValue: { catalog: computed(() => state()) } },
      ],
    }).compileComponents();
  });

  async function createDetail(productId: string) {
    const fixture = TestBed.createComponent(ProductDetail);
    fixture.componentRef.setInput('productId', productId);
    await fixture.whenStable();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  it('renders name, summary, family link, use cases, and sources', async () => {
    const { element } = await createDetail('waf');

    expect(element.querySelector('h1')?.textContent).toContain('Web Application Firewall');
    expect(element.querySelector('.detail-summary')?.textContent).toContain(
      'Filters and blocks malicious HTTP traffic.',
    );
    const familyLink = element.querySelector<HTMLAnchorElement>('.family-chip');
    expect(familyLink?.textContent).toContain('Application security');
    expect(familyLink?.getAttribute('href')).toBe('/#family-application-security');
    expect(element.querySelector('.use-case-list')?.textContent).toContain('Stop DDoS attacks');

    const sourceLinks = element.querySelectorAll<HTMLAnchorElement>('.source-list a');
    expect(sourceLinks).toHaveLength(2);
    expect(sourceLinks[0]?.getAttribute('href')).toBe(
      'https://www.cloudflare.com/application-services/products/waf/',
    );
    expect(sourceLinks[0]?.getAttribute('target')).toBe('_blank');
    expect(sourceLinks[0]?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(sourceLinks[0]?.textContent).toContain('(새 창)');
    expect(element.querySelector('.retrieved')?.textContent).toContain('수집 시각');
  });

  it('shows the graceful empty note when a product has no use-case edges', async () => {
    const { element } = await createDetail('bot-management');

    expect(element.querySelector('.use-case-list')).toBeNull();
    expect(element.querySelector('.empty-note')?.textContent).toContain(
      '관련 use case가 아직 수집되지 않았습니다',
    );
  });

  it('renders in-page not-found with a focusable back link for an unknown id', async () => {
    const { element } = await createDetail('unknown-product');

    const status = element.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.textContent).toContain('unknown-product');

    const back = element.querySelector<HTMLAnchorElement>('a[href="/"]');
    expect(back).not.toBeNull();
    back?.focus();
    expect(document.activeElement).toBe(back);
  });

  it('renders nothing while the catalog is still pending', async () => {
    state.set(undefined);
    const { element } = await createDetail('waf');

    expect(element.querySelector('article, section')).toBeNull();
  });
});
