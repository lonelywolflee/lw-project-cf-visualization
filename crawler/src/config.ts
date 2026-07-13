import { readFile } from 'node:fs/promises';

import { APPROVED_SOURCE_HOSTNAMES, SOURCE_PAGE_KINDS, idSlugSchema } from '@cf-viz/catalog';
import { z } from 'zod';

import { CrawlError } from './errors.js';

/**
 * Approved hostnames this configuration may allow. Config can narrow the
 * catalog-approved list but never widen it — off-list hosts are rejected by
 * construction.
 */
const allowedHostsSchema = z
  .array(z.enum(APPROVED_SOURCE_HOSTNAMES))
  .min(1)
  .refine((hosts) => new Set(hosts).size === hosts.length, {
    error: 'allowedHosts must not contain duplicate hostnames',
  });

/**
 * Operational fetch knobs inside hard safety envelopes. The ranges are the
 * safety contract: a config edit can tune within them but never escape them.
 */
const fetchPolicySchema = z.strictObject({
  timeoutMs: z.int().min(1000).max(30000),
  maxRetries: z.int().min(0).max(3),
  concurrency: z.int().min(1).max(4),
  minRequestIntervalMs: z.int().min(250).max(10000),
});

/**
 * Canonical `https` seed URL, free of query, fragment, port, and credentials
 * so stored provenance stays deterministic. Hostname membership is checked
 * against this config's own `allowedHosts` in the whole-object validation.
 */
const seedUrlSchema = z
  .url({ protocol: /^https$/, error: 'URL must use https' })
  .max(300)
  .refine(
    (value) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return true; // Unparseable input is already reported by z.url().
      }
      return (
        url.search === '' &&
        url.hash === '' &&
        url.port === '' &&
        url.username === '' &&
        url.password === ''
      );
    },
    { error: 'URL must not contain a query, fragment, port, or credentials' },
  );

const sourceEntrySchema = z.strictObject({
  id: idSlugSchema,
  url: seedUrlSchema,
  pageKind: z.enum(SOURCE_PAGE_KINDS),
});

/**
 * Runtime schema for the crawler source configuration file — the single
 * source of both validation and the {@link SourceConfig} type.
 *
 * The whole-object check collects ALL cross-field issues (no fail-fast):
 * allowedHosts membership, pageKind/host coupling, duplicate ids, and
 * duplicate normalized URLs.
 */
const sourceConfigSchema = z
  .strictObject({
    allowedHosts: allowedHostsSchema,
    fetch: fetchPolicySchema,
    sources: z.array(sourceEntrySchema).min(1),
  })
  .check((ctx) => {
    const allowedHosts = new Set<string>(ctx.value.allowedHosts);
    const seenIds = new Set<string>();
    const seenUrlHrefs = new Set<string>();
    ctx.value.sources.forEach((source, index) => {
      if (seenIds.has(source.id)) {
        ctx.issues.push({
          code: 'custom',
          message: `Duplicate source id '${source.id}'`,
          path: ['sources', index, 'id'],
          input: source.id,
        });
      } else {
        seenIds.add(source.id);
      }
      let url: URL;
      try {
        url = new URL(source.url);
      } catch {
        return; // Unparseable URL is already reported by the field schema.
      }
      if (!allowedHosts.has(url.hostname)) {
        ctx.issues.push({
          code: 'custom',
          message: `URL hostname '${url.hostname}' is not listed in allowedHosts`,
          path: ['sources', index, 'url'],
          input: source.url,
        });
      } else {
        const expectedHostname =
          source.pageKind === 'developer-docs' ? 'developers.cloudflare.com' : 'www.cloudflare.com';
        if (url.hostname !== expectedHostname) {
          ctx.issues.push({
            code: 'custom',
            message: `pageKind '${source.pageKind}' requires hostname '${expectedHostname}'`,
            path: ['sources', index, 'pageKind'],
            input: source.pageKind,
          });
        }
      }
      if (seenUrlHrefs.has(url.href)) {
        ctx.issues.push({
          code: 'custom',
          message: `Duplicate source URL '${source.url}'`,
          path: ['sources', index, 'url'],
          input: source.url,
        });
      } else {
        seenUrlHrefs.add(url.href);
      }
    });
  });

/** One crawl seed: stable catalog-compatible id, canonical URL, page kind. */
export type SourceEntry = z.output<typeof sourceEntrySchema>;

/** Fetch tuning knobs, hard-capped by the schema's safety envelope. */
export type FetchPolicy = z.output<typeof fetchPolicySchema>;

/** A fully validated crawler source configuration. */
export type SourceConfig = z.output<typeof sourceConfigSchema>;

/** One actionable validation problem at a concrete config location. */
export interface ConfigIssue {
  readonly path: string;
  readonly message: string;
}

/** Discriminated result of {@link safeParseSourceConfig}. */
export type SourceConfigParseResult =
  | { readonly success: true; readonly config: SourceConfig }
  | { readonly success: false; readonly issues: readonly ConfigIssue[] };

/** Formats a zod issue path into a pointer like `sources[2].url`. */
function formatIssuePath(path: readonly PropertyKey[]): string {
  let formatted = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      formatted += `[${String(segment)}]`;
    } else if (formatted === '') {
      formatted = String(segment);
    } else {
      formatted += `.${String(segment)}`;
    }
  }
  return formatted;
}

function toConfigIssues(error: z.ZodError): readonly ConfigIssue[] {
  return error.issues.flatMap((issue): readonly ConfigIssue[] => {
    // zod reports unrecognized keys at the object root; point each issue at
    // the offending key instead so the path stays actionable.
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({
        path: formatIssuePath([...issue.path, key]),
        message: `Unrecognized key: "${key}"`,
      }));
    }
    return [
      {
        path: formatIssuePath(issue.path),
        message: issue.message,
      },
    ];
  });
}

/**
 * Validates an unknown value as a crawler source configuration without
 * throwing. All issues are collected so a whole config can be fixed in one
 * run.
 */
export function safeParseSourceConfig(input: unknown): SourceConfigParseResult {
  const result = sourceConfigSchema.safeParse(input);
  if (!result.success) {
    return { success: false, issues: toConfigIssues(result.error) };
  }
  return { success: true, config: result.data };
}

/**
 * Validates an unknown value as a crawler source configuration.
 *
 * @throws CrawlError at stage `config`; the message embeds one
 * `path: message` line per issue and never any input content beyond paths.
 */
export function parseSourceConfig(input: unknown): SourceConfig {
  const result = safeParseSourceConfig(input);
  if (!result.success) {
    const lines = result.issues.map((issue) => `  ${issue.path}: ${issue.message}`);
    throw new CrawlError(
      [
        `[config] Source config validation failed with ${String(result.issues.length)} issue(s):`,
        ...lines,
      ].join('\n'),
      { stage: 'config' },
    );
  }
  return result.config;
}

/**
 * Reads, JSON-parses, and validates a source configuration file. This is the
 * only filesystem-touching function in the module; everything else is pure.
 *
 * @throws CrawlError at stage `config` for read failures, malformed JSON,
 * and validation failures alike.
 */
export async function loadSourceConfig(filePath: string): Promise<SourceConfig> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (cause) {
    throw new CrawlError(`[config] Failed to read config file at ${filePath}`, {
      stage: 'config',
      cause,
    });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    throw new CrawlError(`[config] Config file at ${filePath} is not valid JSON`, {
      stage: 'config',
      cause,
    });
  }
  return parseSourceConfig(json);
}
