/**
 * Fetch orchestrator: policy on top of the safe HTTP client. Every source is
 * gated behind a per-host robots.txt decision fetched once through the SAME
 * client (so UA, timeout, retry, and pacing apply to robots too), a bounded
 * worker pool honors the configured concurrency, and the run is
 * all-or-nothing — it completes fully, then either returns every result or
 * throws a {@link CrawlRunError} aggregating every failure in config order
 * (AGENTS §3).
 *
 * Robots decisions are resolved EAGERLY for all `config.allowedHosts` before
 * the pool starts (sequentially, one robots.txt fetch per host). This is
 * deliberate: the client's `guardUrl` hook is synchronous, and a redirect may
 * hop to the OTHER approved host, so that host's robots decision must already
 * be in hand — a lazy per-host cache would need an async guard. With exactly
 * two approved hosts the eager map costs at most one extra request.
 */
import type { SourceConfig, SourceEntry } from './config.js';
import { CrawlError } from './errors.js';
import {
  CRAWLER_USER_AGENT_TOKEN,
  type FetchPageRequest,
  type FetchResult,
} from './http-client.js';
import {
  classifyRobotsResponse,
  crawlDelayFor,
  isPathAllowed,
  type RobotsRules,
} from './robots.js';

/**
 * Structural fetch capability consumed by the orchestrator. `HttpClient`
 * satisfies it; tests satisfy it with a plain stub object, no class instance
 * needed.
 */
export interface PageFetcher {
  fetchPage(request: FetchPageRequest): Promise<FetchResult>;
}

/**
 * Aggregate failure of a crawl run: the run completed, at least one source
 * failed. `message` carries one `[stage url] reason` line per failure, in
 * config order; failure details stay machine-readable on {@link failures}.
 */
export class CrawlRunError extends Error {
  /** Every per-source failure of the run, in config order. */
  readonly failures: readonly CrawlError[];

  constructor(failures: readonly CrawlError[]) {
    super(failures.map((failure) => failure.message).join('\n'));
    this.name = 'CrawlRunError';
    this.failures = failures;
  }
}

/** A host's robots verdict: parsed rules, or everything-allowed (4xx). */
type RobotsDecision = RobotsRules | 'allow-all';

/** A resolved host entry: a usable decision or the failure that produced it. */
type RobotsOutcome = RobotsDecision | CrawlError;

/**
 * Fetches and classifies `https://<host>/robots.txt` through the client, so
 * pacing, timeout, retry, and the allowlist all apply (no guardUrl here —
 * robots gates pages, not itself).
 *
 * @throws CrawlError at stage `robots` when the response demands a full-host
 * stop (5xx), when transport fails, or when a declared crawl-delay exceeds
 * the configured pacing (we refuse to crawl impolitely rather than silently
 * adapt).
 */
async function resolveHostRobots(
  host: string,
  config: SourceConfig,
  client: PageFetcher,
): Promise<RobotsDecision> {
  const robotsUrl = `https://${host}/robots.txt`;
  let result: FetchResult;
  try {
    result = await client.fetchPage({ sourceId: `robots-txt:${host}`, url: robotsUrl });
  } catch (error) {
    if (error instanceof CrawlError && error.stage === 'robots') {
      throw error;
    }
    throw new CrawlError(`[robots ${robotsUrl}] robots.txt fetch failed`, {
      stage: 'robots',
      url: robotsUrl,
      cause: error,
    });
  }
  const availability = classifyRobotsResponse(result.status, result.bodyText);
  if (availability.kind === 'unavailable-allow-all') {
    return 'allow-all';
  }
  if (availability.kind === 'unavailable-disallow-all') {
    throw new CrawlError(
      `[robots ${robotsUrl}] HTTP ${String(result.status)} requires treating the whole host as disallowed`,
      { stage: 'robots', url: robotsUrl },
    );
  }
  const delaySeconds = crawlDelayFor(availability.rules, CRAWLER_USER_AGENT_TOKEN);
  if (delaySeconds !== undefined && delaySeconds * 1000 > config.fetch.minRequestIntervalMs) {
    throw new CrawlError(
      `[robots ${host}] crawl-delay ${String(delaySeconds)}s exceeds configured minRequestIntervalMs — raise it in crawler/config/sources.json`,
      { stage: 'robots', url: robotsUrl },
    );
  }
  return availability.rules;
}

/**
 * Returns the host's robots decision or throws the failure recorded for it.
 * Synchronous on purpose: it backs the client's sync `guardUrl` hook.
 */
function decisionFor(
  robotsByHost: ReadonlyMap<string, RobotsOutcome>,
  host: string,
): RobotsDecision {
  const outcome = robotsByHost.get(host);
  if (outcome === undefined) {
    // Unreachable via config validation and the client's allowlist check;
    // kept as a hard stop rather than a silent allow.
    throw new CrawlError(`[robots ${host}] no robots decision resolved for host`, {
      stage: 'robots',
    });
  }
  if (outcome instanceof CrawlError) {
    throw outcome;
  }
  return outcome;
}

/**
 * Fetches one source: robots gate on the seed URL and (via `guardUrl`) on
 * every redirect hop, then a 2xx policy check on the final status.
 */
async function runSource(
  source: SourceEntry,
  robotsByHost: ReadonlyMap<string, RobotsOutcome>,
  client: PageFetcher,
): Promise<FetchResult> {
  const guardUrl = (url: URL): void => {
    const decision = decisionFor(robotsByHost, url.hostname);
    if (
      decision !== 'allow-all' &&
      !isPathAllowed(decision, CRAWLER_USER_AGENT_TOKEN, url.pathname + url.search)
    ) {
      throw new CrawlError(`[robots ${url.href}] path disallowed by robots.txt`, {
        stage: 'robots',
        url: url.href,
      });
    }
  };
  // Gate the seed itself before any page contact; the client re-runs the
  // same guard on every redirect hop.
  guardUrl(new URL(source.url));
  const result = await client.fetchPage({ sourceId: source.id, url: source.url, guardUrl });
  if (result.status < 200 || result.status >= 300) {
    throw new CrawlError(`[fetch ${result.finalUrl}] HTTP ${String(result.status)}`, {
      stage: 'fetch',
      url: result.finalUrl,
    });
  }
  return result;
}

/** Coerces any thrown value into a stage-tagged CrawlError. */
function toCrawlFailure(error: unknown, sourceUrl: string): CrawlError {
  if (error instanceof CrawlError) {
    return error;
  }
  return new CrawlError(`[fetch ${sourceUrl}] unexpected failure`, {
    stage: 'fetch',
    url: sourceUrl,
    cause: error,
  });
}

/**
 * Fetches every configured source through the client, robots-gated and
 * concurrency-bounded.
 *
 * The run always completes (no fail-fast): a fully successful run resolves
 * with results in config order; otherwise every failure is aggregated into
 * one {@link CrawlRunError}, also in config order, so a whole run can be
 * diagnosed from a single report.
 *
 * @throws CrawlRunError when any source fails.
 */
export async function fetchAllSources(
  config: SourceConfig,
  client: PageFetcher,
): Promise<readonly FetchResult[]> {
  // Eager per-host robots resolution (see module doc). A host-level robots
  // failure is recorded, not thrown: it fails that host's sources during the
  // run while the other host's sources still complete.
  const robotsByHost = new Map<string, RobotsOutcome>();
  for (const host of config.allowedHosts) {
    try {
      robotsByHost.set(host, await resolveHostRobots(host, config, client));
    } catch (error) {
      robotsByHost.set(host, toCrawlFailure(error, `https://${host}/robots.txt`));
    }
  }

  // Bounded worker pool: a shared cursor over a pre-sized outcome slot array;
  // each lane claims the next index, runs it, and stores the outcome in place
  // so config order survives any completion order.
  const total = config.sources.length;
  const outcomes = Array.from<FetchResult | CrawlError | undefined>({ length: total });
  let cursor = 0;
  const lanes = Array.from({ length: Math.min(config.fetch.concurrency, total) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= total) {
        return;
      }
      const source = config.sources[index];
      if (source === undefined) {
        return;
      }
      try {
        outcomes[index] = await runSource(source, robotsByHost, client);
      } catch (error) {
        outcomes[index] = toCrawlFailure(error, source.url);
      }
    }
  });
  await Promise.all(lanes);

  const failures: CrawlError[] = [];
  const results: FetchResult[] = [];
  outcomes.forEach((outcome, index) => {
    if (outcome === undefined) {
      failures.push(
        new CrawlError(`[fetch] source at index ${String(index)} produced no outcome`, {
          stage: 'fetch',
        }),
      );
    } else if (outcome instanceof CrawlError) {
      failures.push(outcome);
    } else {
      results.push(outcome);
    }
  });
  if (failures.length > 0) {
    throw new CrawlRunError(failures);
  }
  return results;
}
