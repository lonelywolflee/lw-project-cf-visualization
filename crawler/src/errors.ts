/** Pipeline stage a crawl failure is attributed to. */
export type CrawlStage =
  'config' | 'robots' | 'fetch' | 'parse' | 'normalize' | 'validate' | 'write';

/**
 * Stage-tagged crawler failure.
 *
 * Message convention: `[<stage>] <short reason>` or `[<stage> <url>] <short
 * reason>`. Reasons carry status codes, hop counts, and issue paths — never
 * response bodies or HTML.
 */
export class CrawlError extends Error {
  /** Stage the failure occurred in. */
  readonly stage: CrawlStage;

  /** URL involved in the failure; undefined for config-file-level failures. */
  readonly url: string | undefined;

  constructor(message: string, options: { stage: CrawlStage; url?: string; cause?: unknown }) {
    super(message, { ...(options.cause !== undefined ? { cause: options.cause } : {}) });
    this.name = 'CrawlError';
    this.stage = options.stage;
    this.url = options.url;
  }
}
