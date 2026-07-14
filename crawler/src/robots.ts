/**
 * Minimal RFC 9309 robots.txt evaluator. Pure and zero-dependency: parsing,
 * group selection, path matching, and availability classification are all
 * decidable without any network access.
 *
 * Group-termination semantics are load-bearing: the real
 * developers.cloudflare.com file interleaves an unknown directive
 * (`Content-Signal:`) and a blank line between `User-agent: *` and its rules.
 * Groups therefore end ONLY when a `User-agent:` line follows at least one
 * rule — never at blank lines or unknown directives.
 */

/** One Allow/Disallow line: `allow` flag plus the verbatim path pattern. */
export interface RobotsRule {
  readonly allow: boolean;
  readonly pattern: string;
}

/** One user-agent group: lowercased tokens, rules, optional crawl delay. */
export interface RobotsGroup {
  readonly userAgents: readonly string[];
  readonly rules: readonly RobotsRule[];
  readonly crawlDelaySeconds?: number;
}

/** A parsed robots.txt file. Zero groups means everything is allowed. */
export interface RobotsRules {
  readonly groups: readonly RobotsGroup[];
}

/**
 * How a robots.txt HTTP response constrains crawling of its host:
 * 2xx yields parsed rules, 4xx allows everything (RFC 9309 §2.3.1.3), and
 * anything else demands treating the whole host as disallowed (§2.3.1.4).
 */
export type RobotsAvailability =
  | { readonly kind: 'available'; readonly rules: RobotsRules }
  | { readonly kind: 'unavailable-allow-all' }
  | { readonly kind: 'unavailable-disallow-all' };

/** Mutable accumulator used only while parsing; frozen into RobotsGroup. */
interface GroupBuilder {
  userAgents: string[];
  rules: RobotsRule[];
  crawlDelaySeconds: number | undefined;
}

/**
 * Parses robots.txt text into user-agent groups.
 *
 * - Lines split on CRLF/CR/LF; `#` comments stripped; blanks are inert.
 * - Directive names are case-insensitive; UA tokens are stored lowercased;
 *   rule patterns are kept verbatim.
 * - Consecutive `User-agent:` lines (with no rules between) share one group.
 * - Rules before any `User-agent:` line are dropped.
 * - Empty Allow/Disallow values match nothing but still mark the group as
 *   ruled, so a following `User-agent:` line starts a NEW group.
 * - `Crawl-delay:` stores non-negative finite seconds on the group; malformed
 *   values are ignored like any other garbage line.
 * - Sitemap, Content-Signal, and unknown directives are fully inert.
 */
export function parseRobotsTxt(text: string): RobotsRules {
  const builders: GroupBuilder[] = [];
  let current: GroupBuilder | null = null;
  let sawRuleInCurrentGroup = false;

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const hashIndex = rawLine.indexOf('#');
    const line = (hashIndex === -1 ? rawLine : rawLine.slice(0, hashIndex)).trim();
    if (line === '') {
      continue;
    }
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) {
      continue;
    }
    const directive = line.slice(0, colonIndex).trim().toLowerCase();
    const value = line.slice(colonIndex + 1).trim();

    if (directive === 'user-agent') {
      if (value === '') {
        continue;
      }
      const token = value.toLowerCase();
      if (current !== null && !sawRuleInCurrentGroup) {
        current.userAgents.push(token);
      } else {
        current = { userAgents: [token], rules: [], crawlDelaySeconds: undefined };
        builders.push(current);
        sawRuleInCurrentGroup = false;
      }
    } else if (directive === 'allow' || directive === 'disallow') {
      if (current === null) {
        continue;
      }
      sawRuleInCurrentGroup = true;
      if (value !== '') {
        current.rules.push({ allow: directive === 'allow', pattern: value });
      }
    } else if (directive === 'crawl-delay') {
      if (current === null || value === '') {
        continue;
      }
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) {
        current.crawlDelaySeconds = seconds;
        sawRuleInCurrentGroup = true;
      }
    }
    // Everything else (sitemap, content-signal, unknown) changes no state.
  }

  return {
    groups: builders.map((builder) => ({
      userAgents: builder.userAgents,
      rules: builder.rules,
      ...(builder.crawlDelaySeconds !== undefined
        ? { crawlDelaySeconds: builder.crawlDelaySeconds }
        : {}),
    })),
  };
}

/** Regex source metacharacters to escape — everything except our `*`/`$`. */
const REGEXP_SPECIALS = /[.+?^${}()|[\]\\]/g;

const matcherCache = new Map<string, RegExp>();

/**
 * Compiles a robots path pattern to an anchored RegExp: `*` matches any
 * sequence, a trailing `$` anchors the end, every other character is literal.
 */
function matcherFor(pattern: string): RegExp {
  const cached = matcherCache.get(pattern);
  if (cached !== undefined) {
    return cached;
  }
  const endAnchored = pattern.endsWith('$');
  const body = endAnchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split('*')
    .map((literal) => literal.replace(REGEXP_SPECIALS, '\\$&'))
    .join('.*');
  const matcher = new RegExp(`^${source}${endAnchored ? '$' : ''}`);
  matcherCache.set(pattern, matcher);
  return matcher;
}

/**
 * Selects the groups governing a user-agent token: candidates are groups
 * whose token is a case-insensitive substring of ours (or `*`); the longest
 * non-`*` token wins and ALL groups carrying that exact token merge; with no
 * specific match, all `*` groups merge; with neither, the result is empty.
 */
function selectGroups(rules: RobotsRules, userAgentToken: string): readonly RobotsGroup[] {
  const token = userAgentToken.toLowerCase();
  let bestToken: string | null = null;
  for (const group of rules.groups) {
    for (const groupToken of group.userAgents) {
      if (groupToken !== '*' && token.includes(groupToken)) {
        if (bestToken === null || groupToken.length > bestToken.length) {
          bestToken = groupToken;
        }
      }
    }
  }
  const selected = bestToken ?? '*';
  return rules.groups.filter((group) => group.userAgents.includes(selected));
}

/**
 * Decides whether a path (pathname plus query, if any) may be fetched by the
 * given user-agent token. The longest matching pattern wins; Allow wins
 * length ties; no matching rule (or no governing group) means allowed.
 */
export function isPathAllowed(rules: RobotsRules, userAgentToken: string, path: string): boolean {
  const groups = selectGroups(rules, userAgentToken);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  let best: RobotsRule | null = null;
  for (const group of groups) {
    for (const rule of group.rules) {
      if (!matcherFor(rule.pattern).test(normalizedPath)) {
        continue;
      }
      if (
        best === null ||
        rule.pattern.length > best.pattern.length ||
        (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)
      ) {
        best = rule;
      }
    }
  }
  return best === null ? true : best.allow;
}

/**
 * Returns the `Crawl-delay:` seconds declared by the groups governing the
 * given user-agent token, or undefined when none declare one.
 */
export function crawlDelayFor(rules: RobotsRules, userAgentToken: string): number | undefined {
  for (const group of selectGroups(rules, userAgentToken)) {
    if (group.crawlDelaySeconds !== undefined) {
      return group.crawlDelaySeconds;
    }
  }
  return undefined;
}

/**
 * Classifies a robots.txt HTTP response per RFC 9309: any 2xx parses the body
 * (missing body parses as empty ⇒ allow-all), any 4xx allows everything, and
 * everything else (5xx and friends) demands a full-host stop. Network-failure
 * handling lives in the orchestrator, not here.
 */
export function classifyRobotsResponse(
  status: number,
  body: string | undefined,
): RobotsAvailability {
  if (status >= 200 && status < 300) {
    return { kind: 'available', rules: parseRobotsTxt(body ?? '') };
  }
  if (status >= 400 && status < 500) {
    return { kind: 'unavailable-allow-all' };
  }
  return { kind: 'unavailable-disallow-all' };
}
