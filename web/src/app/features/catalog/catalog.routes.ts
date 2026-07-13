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
 * route); the two detail pages stay behind `loadComponent` chunks.
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
