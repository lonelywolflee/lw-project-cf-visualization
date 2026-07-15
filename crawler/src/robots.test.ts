import { describe, expect, it } from 'vitest';

import {
  classifyRobotsResponse,
  crawlDelayFor,
  isPathAllowed,
  parseRobotsTxt,
  type RobotsRules,
} from './robots.js';

const TOKEN = 'cf-viz-crawler';

function allowed(text: string, path: string, token: string = TOKEN): boolean {
  return isPathAllowed(parseRobotsTxt(text), token, path);
}

describe('parseRobotsTxt + isPathAllowed', () => {
  it('empty text yields zero groups and allows everything', () => {
    const rules = parseRobotsTxt('');
    expect(rules.groups).toHaveLength(0);
    expect(isPathAllowed(rules, TOKEN, '/anything')).toBe(true);
  });

  it('applies a basic disallow prefix', () => {
    const text = 'User-agent: *\nDisallow: /private/';
    expect(allowed(text, '/private/x')).toBe(false);
    expect(allowed(text, '/public')).toBe(true);
    expect(allowed(text, '/')).toBe(true);
  });

  it('treats an empty Disallow as allow-all', () => {
    expect(allowed('User-agent: *\nDisallow:', '/a/b')).toBe(true);
  });

  it('lets consecutive User-agent lines share one group', () => {
    const text = 'User-agent: alpha\nUser-agent: beta\nDisallow: /x';
    expect(allowed(text, '/x', 'beta')).toBe(false);
    expect(allowed(text, '/x', 'alpha')).toBe(false);
  });

  it('lets an empty Disallow close the group for a following User-agent line', () => {
    // The empty rule marks the first group as ruled, so 'beta' starts a NEW
    // group and must not inherit into the shared-group above.
    const text = 'User-agent: alpha\nDisallow:\nUser-agent: beta\nDisallow: /x';
    expect(allowed(text, '/x', 'alpha')).toBe(true);
    expect(allowed(text, '/x', 'beta')).toBe(false);
  });

  it('ignores directive-name case', () => {
    expect(allowed('USER-AGENT: CF-VIZ-CRAWLER\nDISALLOW: /x', '/x')).toBe(false);
  });

  it('strips full-line and trailing comments', () => {
    const text = '# lead\nUser-agent: * # tail\nDisallow: /a # tail';
    expect(allowed(text, '/a')).toBe(false);
    expect(allowed(text, '/b')).toBe(true);
  });

  it('drops rules that appear before any User-agent line', () => {
    expect(allowed('Disallow: /\nUser-agent: *\nAllow: /', '/x')).toBe(true);
  });

  it('parses CRLF input identically to LF', () => {
    const text = 'User-agent: *\r\nDisallow: /private/';
    expect(allowed(text, '/private/x')).toBe(false);
    expect(allowed(text, '/public')).toBe(true);
    expect(allowed(text, '/')).toBe(true);
  });
});

describe('group selection', () => {
  it('prefers a specific group over *', () => {
    const text = 'User-agent: *\nDisallow: /\n\nUser-agent: cf-viz-crawler\nAllow: /';
    expect(allowed(text, '/docs', TOKEN)).toBe(true);
    expect(allowed(text, '/docs', 'otherbot')).toBe(false);
  });

  it('picks the longest matching user-agent substring', () => {
    const text = 'User-agent: cf\nDisallow: /\n\nUser-agent: cf-viz\nAllow: /';
    expect(allowed(text, '/x', TOKEN)).toBe(true);
  });

  it('merges multiple groups carrying the same token', () => {
    const text = 'User-agent: *\nDisallow: /a\n\nUser-agent: *\nDisallow: /b';
    expect(allowed(text, '/a')).toBe(false);
    expect(allowed(text, '/b')).toBe(false);
  });

  it('allows everything when no group matches and no * group exists', () => {
    expect(allowed('User-agent: googlebot\nDisallow: /', '/x')).toBe(true);
  });

  it('never binds AI-crawler groups like claude-web or gptbot to our token', () => {
    const text = [
      'User-agent: claude-web',
      'Disallow: /',
      '',
      'User-agent: gptbot',
      'Disallow: /',
      '',
      'User-agent: anthropic-ai',
      'Disallow: /',
    ].join('\n');
    expect(allowed(text, '/anything', TOKEN)).toBe(true);
    // Sanity: the groups themselves do bind their own tokens.
    expect(allowed(text, '/anything', 'gptbot')).toBe(false);
  });
});

describe('rule matching', () => {
  it('gives precedence to the longest matching pattern', () => {
    const text = 'User-agent: *\nDisallow: /p\nAllow: /p/public';
    expect(allowed(text, '/p/public/f')).toBe(true);
    expect(allowed(text, '/p/x')).toBe(false);
  });

  it('lets Allow win a pattern-length tie', () => {
    expect(allowed('User-agent: *\nAllow: /page\nDisallow: /page', '/page')).toBe(true);
  });

  it('supports the * wildcard without an implicit end anchor', () => {
    const text = 'User-agent: *\nDisallow: /*.pdf';
    expect(allowed(text, '/a/b.pdf')).toBe(false);
    expect(allowed(text, '/a.pdfx')).toBe(false);
    expect(allowed(text, '/a.txt')).toBe(true);
  });

  it('supports the $ end anchor after a wildcard', () => {
    const text = 'User-agent: *\nDisallow: /*.pdf$';
    expect(allowed(text, '/a.pdf')).toBe(false);
    expect(allowed(text, '/a.pdfx')).toBe(true);
  });

  it('supports the $ end anchor on an exact path', () => {
    const text = 'User-agent: *\nDisallow: /plans$';
    expect(allowed(text, '/plans')).toBe(false);
    expect(allowed(text, '/plans/')).toBe(true);
    expect(allowed(text, '/plansX')).toBe(true);
  });

  it('treats regex metacharacters in patterns as literals', () => {
    const text = 'User-agent: *\nDisallow: /a+b(c)';
    expect(allowed(text, '/a+b(c)')).toBe(false);
    expect(allowed(text, '/aab')).toBe(true);
  });

  it('matches against the query string when the caller passes one', () => {
    expect(allowed('User-agent: *\nDisallow: /search', '/search?q=a')).toBe(false);
  });
});

describe('real-world fixtures', () => {
  // Trimmed from https://developers.cloudflare.com/robots.txt: an unknown
  // directive AND a blank line sit inside the * group — a parser that closes
  // the group there would silently allow all five disallowed paths.
  const developersDocsExcerpt = [
    'User-agent: *',
    'Content-Signal: ai-train=yes, search=yes, ai-input=yes',
    '',
    'Allow: /',
    'Disallow: /client-ip-geolocation',
    'Disallow: /plans/',
    'Disallow: /constellation',
    'Disallow: /cdn-cgi/',
    'Disallow: /email-security/',
  ].join('\n');

  it('keeps the developers.cloudflare.com group open across the blank line', () => {
    const rules = parseRobotsTxt(developersDocsExcerpt);
    expect(rules.groups).toHaveLength(1);
    expect(isPathAllowed(rules, TOKEN, '/workers/')).toBe(true);
    expect(isPathAllowed(rules, TOKEN, '/directory/')).toBe(true);
    expect(isPathAllowed(rules, TOKEN, '/')).toBe(true);
    expect(isPathAllowed(rules, TOKEN, '/client-ip-geolocation')).toBe(false);
    expect(isPathAllowed(rules, TOKEN, '/plans/')).toBe(false);
    expect(isPathAllowed(rules, TOKEN, '/plans/enterprise')).toBe(false);
    expect(isPathAllowed(rules, TOKEN, '/constellation')).toBe(false);
    expect(isPathAllowed(rules, TOKEN, '/cdn-cgi/')).toBe(false);
    expect(isPathAllowed(rules, TOKEN, '/email-security/')).toBe(false);
    expect(isPathAllowed(rules, TOKEN, '/email-security/x')).toBe(false);
  });

  it('handles the www.cloudflare.com shape (generic * plus AI groups)', () => {
    const text = 'User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nAllow: /';
    expect(allowed(text, '/products/anything', TOKEN)).toBe(true);
  });
});

describe('crawlDelayFor', () => {
  it('returns the delay of the governing group and keeps its rules live', () => {
    const rules = parseRobotsTxt('User-agent: *\nCrawl-delay: 2\nDisallow: /x');
    expect(crawlDelayFor(rules, TOKEN)).toBe(2);
    expect(isPathAllowed(rules, TOKEN, '/x')).toBe(false);
  });

  it('returns undefined when no delay is declared', () => {
    const rules = parseRobotsTxt('User-agent: *\nDisallow: /x');
    expect(crawlDelayFor(rules, TOKEN)).toBeUndefined();
  });

  it.each([{ value: 'abc' }, { value: '-1' }])(
    'ignores the malformed value $value',
    ({ value }) => {
      const rules = parseRobotsTxt(`User-agent: *\nCrawl-delay: ${value}`);
      expect(crawlDelayFor(rules, TOKEN)).toBeUndefined();
    },
  );
});

describe('classifyRobotsResponse', () => {
  function availableRules(status: number, body: string | undefined): RobotsRules {
    const availability = classifyRobotsResponse(status, body);
    expect(availability.kind).toBe('available');
    if (availability.kind !== 'available') {
      throw new Error('expected an available classification');
    }
    return availability.rules;
  }

  it('parses a 200 body into usable rules', () => {
    const rules = availableRules(200, 'User-agent: *\nDisallow: /private/');
    expect(rules.groups).toHaveLength(1);
    expect(isPathAllowed(rules, TOKEN, '/private/x')).toBe(false);
    expect(isPathAllowed(rules, TOKEN, '/public')).toBe(true);
  });

  it('treats a 204 without a body as available allow-all', () => {
    const rules = availableRules(204, undefined);
    expect(rules.groups).toHaveLength(0);
    expect(isPathAllowed(rules, TOKEN, '/anything')).toBe(true);
  });

  it.each([{ status: 404 }, { status: 410 }, { status: 403 }])(
    'classifies $status as unavailable-allow-all',
    ({ status }) => {
      expect(classifyRobotsResponse(status, undefined)).toEqual({
        kind: 'unavailable-allow-all',
      });
    },
  );

  it.each([{ status: 500 }, { status: 503 }])(
    'classifies $status as unavailable-disallow-all',
    ({ status }) => {
      expect(classifyRobotsResponse(status, undefined)).toEqual({
        kind: 'unavailable-disallow-all',
      });
    },
  );
});
