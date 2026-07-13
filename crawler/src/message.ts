/**
 * Builds the startup banner for the not-yet-implemented crawler.
 *
 * Kept as a pure function so the entry point stays trivially testable
 * without touching stdout, the network, or the filesystem.
 */
export function crawlerStatusMessage(catalogPackageName: string): string {
  return [
    'crawler not implemented yet (issue #3+).',
    `Shared data contract wired via ${catalogPackageName}.`,
  ].join(' ');
}
