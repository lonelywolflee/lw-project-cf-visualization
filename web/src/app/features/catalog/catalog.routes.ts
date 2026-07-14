import { Routes } from '@angular/router';

import { CatalogOverview } from './catalog-overview';
import { CatalogShell } from './catalog-shell';

/**
 * Catalog feature routes, loaded lazily as one chunk via `loadChildren`.
 *
 * {@link CatalogShell} is the layout gate: it renders the loading, error,
 * invalid-data, and empty states itself and only places a `<router-outlet>`
 * on screen once the catalog reached `success`. Children may therefore
 * assume the catalog signal is present (their `pending` branch is type
 * honesty for the instant before the gate settles).
 *
 * The overview is imported statically (it is the first paint of the default
 * route); the discovery page and the two detail pages stay behind
 * `loadComponent` chunks. Discovery lives in `features/discovery/` but mounts
 * here so it shares the shell gate — a second app-level route would either
 * bypass the gate or instantiate a second shell.
 */
export const CATALOG_ROUTES: Routes = [
  {
    path: '',
    component: CatalogShell,
    children: [
      {
        path: '',
        pathMatch: 'full',
        component: CatalogOverview,
        title: 'Cloudflare Product & Solution Explorer',
      },
      {
        path: 'discovery',
        loadComponent: () => import('../discovery/discovery-page').then((m) => m.DiscoveryPage),
        title: '검색과 필터 | Cloudflare Product & Solution Explorer',
      },
      {
        path: 'relationships',
        loadComponent: () =>
          import('../relationships/relationships-page').then((m) => m.RelationshipsPage),
        title: '관계 보기 | Cloudflare Product & Solution Explorer',
      },
      {
        path: 'products/:productId',
        loadComponent: () => import('./product-detail').then((m) => m.ProductDetail),
        title: 'Product 상세 | Cloudflare Product & Solution Explorer',
      },
      {
        path: 'solutions/:solutionId',
        loadComponent: () => import('./solution-detail').then((m) => m.SolutionDetail),
        title: 'Solution 상세 | Cloudflare Product & Solution Explorer',
      },
    ],
  },
];
