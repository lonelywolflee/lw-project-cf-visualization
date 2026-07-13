/**
 * Identity primitives for catalog entities.
 *
 * Two distinct concepts:
 * - identity key ({@link pathKeyOf}): the cross-page join key (lowercased
 *   pathname, trailing slash stripped). Never serialized — it only exists so
 *   an overview card href and a dedicated page's canonical URL identify the
 *   same entity.
 * - id ({@link slugify} / {@link idFromPath}): the serialized catalog id, a
 *   pure function of official page content or URL — never of array position —
 *   so ids are stable and order-independent by construction.
 *
 * All functions are pure: no clock, network, or filesystem.
 */
import { CrawlError } from './errors.js';
import { collapseWhitespace } from './parse/text.js';

/**
 * Derive a catalog-valid kebab-case slug from an official name or URL
 * segment: NFKD-fold diacritics, lowercase, replace non-[a-z0-9] runs with
 * '-', trim hyphens, cap at 64 characters, then re-trim any trailing hyphen
 * the cap exposed. The result satisfies the catalog idSlugSchema by
 * construction (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, max 64).
 *
 * Throws a CrawlError at stage 'normalize' when no slug can be derived (the
 * echoed input is a short official name, never a page body).
 */
export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
  if (slug.length === 0) {
    throw new CrawlError(`[normalize] cannot derive a slug from '${collapseWhitespace(input)}'`, {
      stage: 'normalize',
    });
  }
  return slug;
}

/**
 * Cross-page identity join key: the lowercased URL pathname with any trailing
 * slash stripped (root collapses to '/'). Accepts absolute URLs or bare
 * paths. Never serialized into the catalog.
 */
export function pathKeyOf(url: string): string {
  const pathname = toPathname(url).toLowerCase();
  const stripped = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return stripped.length === 0 ? '/' : stripped;
}

/**
 * Serialized id derived from a URL: the last non-empty path segment,
 * slugified (e.g. '/products/cdn/' → 'cdn'). Accepts absolute URLs or bare
 * paths. Throws a CrawlError at stage 'normalize' when the path has no
 * segment (e.g. '/').
 */
export function idFromPath(url: string): string {
  const segments = toPathname(url)
    .split('/')
    .filter((segment) => segment.length > 0);
  const last = segments.at(-1);
  if (last === undefined) {
    throw new CrawlError(`[normalize] cannot derive an id from a path without segments`, {
      stage: 'normalize',
      url,
    });
  }
  return slugify(last);
}

/** Pathname of an absolute URL or bare path (resolved against a throwaway base). */
function toPathname(url: string): string {
  return new URL(url, 'https://placeholder.invalid').pathname;
}
