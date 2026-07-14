/**
 * Shared pure helpers over validated catalog entities, consumed by the map
 * and graph selectors. Feature-specific read models live next to their
 * feature (map-selectors, graph-selectors).
 */

interface NamedEntity {
  readonly id: string;
  readonly name: string;
}

/**
 * Deterministic display order: official name, case-insensitive, compared by
 * code point; ties broken by unique id.
 *
 * `localeCompare` is intentionally avoided: its result depends on the
 * runtime's ICU data and active locale, which breaks the house rule that the
 * same input produces the same output everywhere (dev machine, CI, browser).
 */
export function compareByNameThenId(a: NamedEntity, b: NamedEntity): number {
  const aName = a.name.toLowerCase();
  const bName = b.name.toLowerCase();
  if (aName < bName) return -1;
  if (aName > bName) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}
