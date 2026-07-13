/**
 * Safe HTTP client for the crawler: identifiable User-Agent, per-attempt
 * timeout, bounded exponential retry, paced request starts, and manual
 * redirect following that validates every hop against the host allowlist
 * BEFORE the hop is contacted (not even DNS for an off-allowlist host).
 *
 * Empirically verified against Node 24 built-in fetch (undici):
 * - `redirect: 'manual'` resolves with the 3xx response itself and
 *   `headers.get('location')` returns the RAW header value, so relative
 *   Locations must be resolved with `new URL(location, currentUrl)`.
 * - `AbortSignal.timeout(ms)` rejects with a DOMException named
 *   `'TimeoutError'`.
 * - Connection-level failures reject with `TypeError('fetch failed')` whose
 *   `cause` is an Error carrying a `code` such as `'ECONNREFUSED'` (an
 *   AggregateError for multi-address hostnames).
 *
 * Error hygiene (AGENTS §6): errors carry stage, URL, status codes, and hop
 * counts — never response bodies or HTML.
 */
import { CrawlError } from './errors.js';

/** Product token this crawler announces in robots.txt group matching. */
export const CRAWLER_USER_AGENT_TOKEN = 'cf-viz-crawler';

/** Full identifiable User-Agent sent with every request. */
export const CRAWLER_USER_AGENT =
  'cf-viz-crawler/0.1.0 (+https://github.com/lonelywolflee/lw-project-cf-visualization)';

/** Injectable fetch boundary. Narrower than `typeof fetch` but satisfied by it. */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface HttpClientOptions {
  readonly userAgent: string;
  readonly timeoutMs: number;
  /** Retries AFTER the first attempt. */
  readonly maxRetries: number;
  /** Spacing between request STARTS (instance-wide). */
  readonly minRequestIntervalMs: number;
  readonly allowedHosts: readonly string[];
  /** Maximum redirect hops per fetch; defaults to 5. */
  readonly maxRedirects?: number;
  /** Defaults to `globalThis.fetch`. */
  readonly fetchImpl?: FetchLike;
  /** Defaults to a setTimeout-backed promise. */
  readonly sleepImpl?: (ms: number) => Promise<void>;
}

export interface FetchPageRequest {
  readonly sourceId: string;
  readonly url: string;
  /**
   * Orchestrator hook, runs per hop AFTER the allowlist check; may throw
   * CrawlError to veto the hop before it is contacted.
   */
  readonly guardUrl?: (url: URL) => void;
}

export interface FetchResult {
  readonly sourceId: string;
  readonly requestedUrl: string;
  /** Guaranteed allowlisted. */
  readonly finalUrl: string;
  /** Final non-3xx status — the client does NOT enforce 2xx (policy is the orchestrator's). */
  readonly status: number;
  readonly contentType: string | null;
  /** UTC ISO timestamp (`Z` suffix) taken when the final response arrived. */
  readonly retrievedAt: string;
  /** Redirect hops taken to reach {@link finalUrl}. */
  readonly redirectCount: number;
  /** In-memory only; NEVER logged or embedded in errors. */
  readonly bodyText: string;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Backoff schedule; `maxRetries` takes a prefix of it. */
const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

/**
 * Internal marker for failures worth retrying (timeout, network, 429/5xx).
 * Never escapes {@link HttpClient.fetchPage}; exhausted retries convert the
 * last one into a CrawlError.
 */
class RetryableFailure extends Error {
  /** Short reason: status code or cause code — never a response body. */
  readonly reason: string;

  /** URL of the hop that failed. */
  readonly url: string;

  constructor(reason: string, url: string, cause?: unknown) {
    super(reason, { ...(cause !== undefined ? { cause } : {}) });
    this.name = 'RetryableFailure';
    this.reason = reason;
    this.url = url;
  }
}

interface ClassifiedFailure {
  readonly kind: 'timeout' | 'network' | 'other';
  readonly code: string | undefined;
}

/** Reads a Node error `code` without unsafe member access on `unknown`. */
function errorCode(error: Error): string | undefined {
  const code: unknown = Reflect.get(error, 'code');
  if (typeof code === 'string') {
    return code;
  }
  if (error instanceof AggregateError) {
    for (const member of error.errors as readonly unknown[]) {
      if (member instanceof Error) {
        const memberCode: unknown = Reflect.get(member, 'code');
        if (typeof memberCode === 'string') {
          return memberCode;
        }
      }
    }
  }
  return undefined;
}

/** Classifies a fetch rejection for retryable-vs-not decisions. */
function classifyFetchFailure(error: unknown): ClassifiedFailure {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return { kind: 'timeout', code: undefined };
  }
  if (error instanceof TypeError && error.cause instanceof Error) {
    return { kind: 'network', code: errorCode(error.cause) };
  }
  return { kind: 'other', code: undefined };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class HttpClient {
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly minRequestIntervalMs: number;
  private readonly allowedHosts: readonly string[];
  private readonly maxRedirects: number;
  private readonly fetchImpl: FetchLike;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  /**
   * Instance-wide pacing gate: each request start awaits the chain and
   * extends it with one `minRequestIntervalMs` sleep, so consecutive starts
   * (including redirect hops and retries) stay spaced apart.
   */
  private lastStart: Promise<void> = Promise.resolve();

  constructor(options: HttpClientOptions) {
    this.userAgent = options.userAgent;
    this.timeoutMs = options.timeoutMs;
    this.maxRetries = options.maxRetries;
    this.minRequestIntervalMs = options.minRequestIntervalMs;
    this.allowedHosts = options.allowedHosts;
    this.maxRedirects = options.maxRedirects ?? 5;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.sleepImpl = options.sleepImpl ?? defaultSleep;
  }

  /**
   * Fetches one page, following redirects hop by hop. Every hop (including
   * the first) is allowlist-checked and guard-checked before contact. The
   * final non-3xx status is returned as a {@link FetchResult}; only
   * timeouts, network failures, and 429/5xx are retried.
   *
   * @throws CrawlError at stage `fetch` for allowlist/redirect violations,
   * guard vetoes, and retry exhaustion.
   */
  async fetchPage(request: FetchPageRequest): Promise<FetchResult> {
    const delays = RETRY_DELAYS_MS.slice(0, this.maxRetries);
    let lastFailure: RetryableFailure | undefined;
    for (let attempt = 0; attempt <= delays.length; attempt += 1) {
      if (attempt > 0) {
        await this.sleepImpl(delays[attempt - 1] ?? 0);
      }
      try {
        return await this.fetchChain(request);
      } catch (error) {
        if (error instanceof RetryableFailure) {
          lastFailure = error;
          continue;
        }
        throw error;
      }
    }
    if (lastFailure === undefined) {
      throw new CrawlError(`[fetch ${request.url}] retry loop exited without a failure`, {
        stage: 'fetch',
        url: request.url,
      });
    }
    throw new CrawlError(
      `[fetch ${lastFailure.url}] ${lastFailure.reason} (after ${String(delays.length)} retries)`,
      {
        stage: 'fetch',
        url: lastFailure.url,
        cause: lastFailure.cause ?? lastFailure,
      },
    );
  }

  /** One attempt: the full redirect chain from the originally requested URL. */
  private async fetchChain(request: FetchPageRequest): Promise<FetchResult> {
    let current = this.parseRequestedUrl(request.url);
    this.assertAllowedUrl(current);
    this.runGuard(request, current);
    let redirectCount = 0;

    for (;;) {
      await this.awaitStartTurn();
      let response: Response;
      try {
        response = await this.fetchImpl(current, {
          redirect: 'manual',
          headers: { 'user-agent': this.userAgent, accept: 'text/html' },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        const failure = classifyFetchFailure(error);
        if (failure.kind === 'other') {
          throw new CrawlError(`[fetch ${current.href}] request failed`, {
            stage: 'fetch',
            url: current.href,
            cause: error,
          });
        }
        const reason =
          failure.kind === 'timeout'
            ? `timed out after ${String(this.timeoutMs)}ms`
            : `network failure${failure.code === undefined ? '' : ` (${failure.code})`}`;
        throw new RetryableFailure(reason, current.href, error);
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        // Drain the hop's body to return the socket to the keep-alive pool.
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (location === null) {
          throw new CrawlError(
            `[fetch ${current.href}] redirect ${String(response.status)} without a Location header`,
            { stage: 'fetch', url: current.href },
          );
        }
        redirectCount += 1;
        if (redirectCount > this.maxRedirects) {
          throw new CrawlError(
            `[fetch ${current.href}] redirect limit exceeded (${String(redirectCount)} hops)`,
            { stage: 'fetch', url: current.href },
          );
        }
        let next: URL;
        try {
          // undici returns the raw header; resolve relative Locations here.
          next = new URL(location, current);
        } catch (cause) {
          throw new CrawlError(`[fetch ${current.href}] redirect Location is not a valid URL`, {
            stage: 'fetch',
            url: current.href,
            cause,
          });
        }
        this.assertAllowedUrl(next);
        this.runGuard(request, next);
        current = next;
        continue;
      }

      if (response.status === 429 || response.status >= 500) {
        await response.body?.cancel();
        throw new RetryableFailure(`HTTP ${String(response.status)}`, current.href);
      }

      const bodyText = await response.text();
      return {
        sourceId: request.sourceId,
        requestedUrl: request.url,
        finalUrl: current.href,
        status: response.status,
        contentType: response.headers.get('content-type'),
        retrievedAt: new Date().toISOString(),
        redirectCount,
        bodyText,
      };
    }
  }

  private parseRequestedUrl(url: string): URL {
    try {
      return new URL(url);
    } catch (cause) {
      throw new CrawlError(`[fetch ${url}] not a valid URL`, { stage: 'fetch', url, cause });
    }
  }

  /**
   * Enforces the safety envelope for a hop BEFORE it is contacted: https
   * only (plain http is tolerated solely for 127.0.0.1 loopback so the
   * offline test suite can run a local server) and hostname membership in
   * the allowlist.
   */
  private assertAllowedUrl(url: URL): void {
    const isLoopbackHttp = url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !isLoopbackHttp) {
      throw new CrawlError(`[fetch ${url.href}] protocol '${url.protocol}' is not https`, {
        stage: 'fetch',
        url: url.href,
      });
    }
    if (!this.allowedHosts.includes(url.hostname)) {
      throw new CrawlError(`[fetch ${url.href}] hostname '${url.hostname}' is not allowlisted`, {
        stage: 'fetch',
        url: url.href,
      });
    }
  }

  private runGuard(request: FetchPageRequest, url: URL): void {
    if (request.guardUrl === undefined) {
      return;
    }
    try {
      request.guardUrl(url);
    } catch (error) {
      if (error instanceof CrawlError) {
        throw error;
      }
      throw new CrawlError(`[fetch ${url.href}] guardUrl rejected the URL`, {
        stage: 'fetch',
        url: url.href,
        cause: error,
      });
    }
  }

  /**
   * Awaits this instance's turn to start a request and extends the pacing
   * chain by one interval for the next starter. A zero interval keeps the
   * chain sleep-free so injected test sleeps only record retry backoff.
   */
  private awaitStartTurn(): Promise<void> {
    const turn = this.lastStart;
    if (this.minRequestIntervalMs > 0) {
      this.lastStart = turn.then(() => this.sleepImpl(this.minRequestIntervalMs));
    }
    return turn;
  }
}
