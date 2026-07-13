import { describe, expect, it } from 'vitest';

import { boundedField, collapseWhitespace, FIELD_CAPS, trimSummary } from './text.js';

describe('collapseWhitespace', () => {
  it('collapses newlines and indentation runs to single spaces', () => {
    expect(collapseWhitespace('  Content \n\t   Delivery \r\n Network ')).toBe(
      'Content Delivery Network',
    );
  });

  it('collapses decoded &nbsp; (U+00A0) like any other whitespace', () => {
    expect(collapseWhitespace('Zero\u00A0\u00A0Trust access')).toBe('Zero Trust access');
  });

  it('returns an empty string for blank input', () => {
    expect(collapseWhitespace(' \n\t ')).toBe('');
  });
});

describe('boundedField', () => {
  it('returns the collapsed value when within the cap', () => {
    expect(boundedField(' Cloudflare  CDN ', FIELD_CAPS.name)).toBe('Cloudflare CDN');
  });

  it('returns undefined for blank input', () => {
    expect(boundedField('   \n ', FIELD_CAPS.name)).toBeUndefined();
  });

  it('returns undefined for over-cap input (structure drift is an error upstream)', () => {
    expect(boundedField('x'.repeat(FIELD_CAPS.name + 1), FIELD_CAPS.name)).toBeUndefined();
  });

  it('accepts a value exactly at the cap', () => {
    const exact = 'x'.repeat(FIELD_CAPS.name);
    expect(boundedField(exact, FIELD_CAPS.name)).toBe(exact);
  });
});

describe('trimSummary', () => {
  it('passes short text through collapsed and untrimmed', () => {
    expect(trimSummary(' A short  summary. ')).toBe('A short summary.');
  });

  it('returns text exactly at the cap unchanged', () => {
    const exact = 'x'.repeat(FIELD_CAPS.summary);
    expect(trimSummary(exact)).toBe(exact);
  });

  it('cuts long text at the last sentence boundary within the cap', () => {
    const sentence = 'Cloudflare protects and accelerates any application online. ';
    const long = sentence.repeat(12);
    const trimmed = trimSummary(long);
    expect(trimmed.length).toBeLessThanOrEqual(FIELD_CAPS.summary);
    expect(trimmed.endsWith('.')).toBe(true);
    expect(trimmed).toBe(sentence.repeat(8).trimEnd());
    expect(trimSummary(long)).toBe(trimmed);
  });

  it('supports "!" and "?" sentence terminators', () => {
    const long = `Is it fast? ${'x'.repeat(600)}`;
    expect(trimSummary(long)).toBe('Is it fast?');
  });

  it('hard cuts at the cap and trims when no sentence boundary exists', () => {
    const unbroken = 'x'.repeat(FIELD_CAPS.summary + 100);
    expect(trimSummary(unbroken)).toBe('x'.repeat(FIELD_CAPS.summary));

    const words = 'word '.repeat(150).trim();
    const trimmed = trimSummary(words);
    expect(trimmed.length).toBeLessThanOrEqual(FIELD_CAPS.summary);
    expect(trimmed.endsWith('word')).toBe(true);
  });

  it('honours an explicit cap', () => {
    expect(trimSummary('First one. Second one is longer.', 15)).toBe('First one.');
  });

  it('throws on blank input (callers must pre-check)', () => {
    expect(() => trimSummary('  \n ')).toThrow('non-blank');
  });
});
