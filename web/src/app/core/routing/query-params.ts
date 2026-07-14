/**
 * Query-param plumbing shared by URL-driven feature pages (the map and the
 * solution graph). Lives in core because it owns no domain: it only smooths
 * over the router's raw param shapes.
 */

/**
 * First string out of a raw query param value. Query params can legally
 * repeat (`?family=a&family=b`), in which case the router hands the bound
 * input a string array despite the input's declared type; the first
 * occurrence wins.
 */
export function firstParamValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}
