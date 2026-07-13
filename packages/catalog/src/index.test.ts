import { describe, expect, it } from 'vitest';

import { CATALOG_PACKAGE_NAME } from './index.js';

describe('catalog package identity', () => {
  it('exposes the package name', () => {
    expect(CATALOG_PACKAGE_NAME).toBe('@cf-viz/catalog');
  });
});
