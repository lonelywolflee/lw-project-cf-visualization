import { computed, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Catalog } from '@cf-viz/catalog';

import { CatalogStore } from '../../core/catalog/catalog-store';
import { SolutionDetail } from './solution-detail';

const catalog: Catalog = {
  schemaVersion: '1',
  generatedAt: '2026-07-14T00:00:00Z',
  sources: [
    {
      id: 'sase-solution-page',
      url: 'https://www.cloudflare.com/zero-trust/solutions/sase/',
      pageKind: 'marketing-solution',
      title: 'Cloudflare SASE',
      retrievedAt: '2026-07-14T08:30:00Z',
    },
    {
      id: 'solutions-overview',
      url: 'https://www.cloudflare.com/solutions/',
      pageKind: 'marketing-overview',
      title: 'Our solutions',
      retrievedAt: '2026-07-14T08:31:00Z',
    },
  ],
  productFamilies: [],
  products: [],
  solutions: [
    {
      id: 'sase',
      name: 'SASE',
      summary: 'Converges networking and security into one cloud service edge.',
      sourceIds: ['sase-solution-page', 'solutions-overview'],
    },
    {
      id: 'serverless',
      name: 'Serverless',
      summary: 'Builds and runs applications without managing servers.',
      sourceIds: ['solutions-overview'],
    },
  ],
  useCases: [
    {
      id: 'secure-hybrid-work',
      name: 'Secure hybrid work',
      summary: 'Gives remote and office employees safe access to internal apps.',
      sourceIds: ['sase-solution-page'],
    },
  ],
  relationships: [
    {
      type: 'solution-use-case',
      fromId: 'sase',
      toId: 'secure-hybrid-work',
      sourceIds: ['sase-solution-page'],
    },
  ],
};

describe('SolutionDetail', () => {
  let state: WritableSignal<Catalog | undefined>;

  beforeEach(async () => {
    state = signal<Catalog | undefined>(catalog);
    await TestBed.configureTestingModule({
      imports: [SolutionDetail],
      providers: [
        provideRouter([]),
        { provide: CatalogStore, useValue: { catalog: computed(() => state()) } },
      ],
    }).compileComponents();
  });

  async function createDetail(solutionId: string) {
    const fixture = TestBed.createComponent(SolutionDetail);
    fixture.componentRef.setInput('solutionId', solutionId);
    await fixture.whenStable();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  it('renders name, summary, use cases, and sources with safe link attributes', async () => {
    const { element } = await createDetail('sase');

    expect(element.querySelector('h1')?.textContent).toContain('SASE');
    expect(element.querySelector('.detail-summary')?.textContent).toContain(
      'Converges networking and security into one cloud service edge.',
    );
    expect(element.querySelector('.family-chip')).toBeNull();
    expect(element.querySelector('.use-case-list')?.textContent).toContain('Secure hybrid work');

    const sourceLinks = element.querySelectorAll<HTMLAnchorElement>('.source-list a');
    expect(sourceLinks).toHaveLength(2);
    expect(sourceLinks[0]?.getAttribute('href')).toBe(
      'https://www.cloudflare.com/zero-trust/solutions/sase/',
    );
    expect(sourceLinks[0]?.getAttribute('target')).toBe('_blank');
    expect(sourceLinks[0]?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(sourceLinks[0]?.textContent).toContain('(새 창)');
    expect(element.querySelector('.retrieved')?.textContent).toContain('수집 시각');
  });

  it('shows the graceful empty note when a solution has no use-case edges', async () => {
    const { element } = await createDetail('serverless');

    expect(element.querySelector('.use-case-list')).toBeNull();
    expect(element.querySelector('.empty-note')?.textContent).toContain(
      '관련 use case가 아직 수집되지 않았습니다',
    );
  });

  it('renders in-page not-found with a focusable back link for an unknown id', async () => {
    const { element } = await createDetail('unknown-solution');

    const status = element.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.textContent).toContain('unknown-solution');

    const back = element.querySelector<HTMLAnchorElement>('a[href="/"]');
    expect(back).not.toBeNull();
    back?.focus();
    expect(document.activeElement).toBe(back);
  });

  it('renders nothing while the catalog is still pending', async () => {
    state.set(undefined);
    const { element } = await createDetail('sase');

    expect(element.querySelector('article, section')).toBeNull();
  });
});
