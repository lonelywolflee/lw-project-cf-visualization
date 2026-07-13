import { describe, expect, it } from 'vitest';

import { crawlerStatusMessage } from './message.js';

describe('crawlerStatusMessage', () => {
  it('states that the crawler is not implemented and names the catalog package', () => {
    const message = crawlerStatusMessage('@cf-viz/catalog');

    expect(message).toContain('crawler not implemented yet (issue #3+)');
    expect(message).toContain('@cf-viz/catalog');
  });
});
