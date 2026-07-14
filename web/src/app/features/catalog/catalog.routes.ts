import { Routes } from '@angular/router';

import { MapPage } from '../map/map-page';
import { CatalogShell } from './catalog-shell';

/**
 * Catalog feature routes, loaded lazily as one chunk via `loadChildren`.
 *
 * {@link CatalogShell} is the layout gate: it renders the loading, error,
 * invalid-data, and empty states itself and only places a `<router-outlet>`
 * on screen once BOTH documents reached `success`. Children may therefore
 * assume the catalog and curated signals are present (their `pending`
 * branch is type honesty for the instant before the gate settles).
 *
 * The map is imported statically (it is the first paint of the default
 * route); the browse overview, discovery, and the two detail pages stay
 * behind `loadComponent` chunks. Feature pages from other folders mount
 * here so they share the shell gate — a second app-level route would
 * either bypass the gate or instantiate a second shell.
 */
export const CATALOG_ROUTES: Routes = [
  {
    path: '',
    component: CatalogShell,
    children: [
      {
        path: '',
        pathMatch: 'full',
        component: MapPage,
        title: 'Cloudflare Product & Solution Explorer',
      },
      {
        path: 'browse',
        loadComponent: () => import('./catalog-overview').then((m) => m.CatalogOverview),
        title: '카탈로그 | Cloudflare Product & Solution Explorer',
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
